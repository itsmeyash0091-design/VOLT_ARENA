"""Artificial test fixtures only; never shown as real market history."""
from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from engine import PortfolioInputError, dispatch
from scenarios import get_library, library, target_loss, validate
from stress_analysis import block_indices, joint_returns, reverse_stress, run_portfolio_stress


def holdings():
    return [
        {"ticker": "ALPHA", "exchange": "NSE", "instrumentType": "stock", "quantity": "2"},
        {"ticker": "BETA", "exchange": "NSE", "instrumentType": "etf", "quantity": "3"},
    ]


def history(n=310, multiplier=1.0):
    dates = pd.bdate_range("2023-01-02", periods=n, tz="Asia/Kolkata")
    # Explicitly artificial prices with repeated rises and falls, not a market model.
    returns = np.array([((i * 13) % 21 - 10) / 1000 for i in range(n)])
    return pd.DataFrame({"Adj Close": 100 * multiplier * np.cumprod(1 + returns)}, index=dates)


class ScenarioValidationTests(unittest.TestCase):
    def test_library_is_static_json_and_defaults_match_request(self):
        result = get_library()
        self.assertEqual(result["kind"], "hypothetical-static-json")
        self.assertEqual(result["simulation"], {"horizonTradingDays": 252, "pathCount": 1000, "blockTradingDays": 20, "seed": 20261111})
        self.assertEqual(dispatch({"operation": "get_static_scenarios"}), result)
        self.assertEqual(len({s["id"] for s in result["scenarios"]}), len(result["scenarios"]))

    def test_clamps_and_discloses_without_mutating_static_library(self):
        result = validate("broad-selloff", {"stockShockPct": "-150", "etfShockPct": "80"})
        self.assertEqual(result["stockShockPct"], -95)
        self.assertEqual(result["etfShockPct"], 50)
        self.assertEqual(len(result["adjustments"]), 2)
        self.assertEqual(validate("broad-selloff")["stockShockPct"], -20)
        self.assertEqual(validate("broad-selloff", {"stockShockPct": "-95"})["adjustments"], [])

    def test_rejects_unknown_fields_scenarios_and_nonfinite_inputs(self):
        for value in ["NaN", "inf", "", None, True, {}, []]:
            with self.subTest(value=value), self.assertRaises(PortfolioInputError):
                validate("broad-selloff", {"stockShockPct": value})
        for identifier, overrides in [("generated-crash", None), ("broad-selloff", {"llmScenario": "x"}), ("broad-selloff", [])]:
            with self.subTest(identifier=identifier, overrides=overrides), self.assertRaises(PortfolioInputError):
                validate(identifier, overrides)

    def test_reverse_targets_reject_invalid_values(self):
        for value in ["0", "-1", "100", "NaN", "inf", "", True, None]:
            with self.subTest(value=value), self.assertRaises(PortfolioInputError):
                target_loss(value)

    def test_invalid_static_json_definitions_fail_instead_of_being_repaired(self):
        for field, value in [("stockShockPct", -101), ("etfShockPct", True)]:
            data = library()
            data["scenarios"][0][field] = value
            with patch("scenarios.LIBRARY_PATH") as path:
                path.read_text.return_value = json.dumps(data)
                with self.assertRaises(ValueError):
                    get_library()
        data = library()
        data["simulation"]["blockTradingDays"] = 0
        with patch("scenarios.LIBRARY_PATH") as path:
            path.read_text.return_value = json.dumps(data)
            with self.assertRaises(ValueError):
                get_library()


class JointBlockTests(unittest.TestCase):
    def test_same_row_indices_and_contiguous_blocks_preserve_joint_vectors(self):
        config = get_library()["simulation"]
        config = {**config, "pathCount": 3}
        rows = np.column_stack((np.arange(300) / 100000, -2 * np.arange(300) / 100000))
        starts = list(range(len(rows) - config["blockTradingDays"] + 1))
        indices = block_indices(len(rows), starts, config)
        self.assertTrue(np.array_equal(indices, block_indices(len(rows), starts, config)))
        sampled = rows[indices]
        np.testing.assert_allclose(sampled[:, :, 1], -2 * sampled[:, :, 0], atol=0)
        for path in indices:
            for start in range(0, 252, 20):
                self.assertTrue(np.all(np.diff(path[start:start + 20]) == 1))
        self.assertFalse(np.array_equal(indices, block_indices(len(rows), starts, {**config, "seed": config["seed"] + 1})))

    def test_missing_dates_and_long_calendar_gaps_are_never_bridged(self):
        dates = pd.bdate_range("2023-01-02", periods=80).strftime("%Y-%m-%d").tolist()
        first = {day: 100 + index for index, day in enumerate(dates)}
        second = dict(first)
        del second[dates[35]]
        rows, starts, excluded = joint_returns([first, second], 20)
        self.assertEqual(excluded, 2)  # Both intervals touching the missing source value.
        self.assertEqual(len(rows), 77)
        # The two retained runs have 34 and 43 rows: 15 + 24 possible blocks.
        self.assertEqual(len(starts), 39)
        self.assertFalse(any(start <= 33 and start + 19 >= 34 for start in starts))
        long_gap = {day: value for day, value in first.items() if day not in dates[30:40]}
        _rows, _starts, gaps = joint_returns([long_gap], 20)
        self.assertEqual(gaps, 1)


class StressAnalysisTests(unittest.TestCase):
    def analyze(self, histories=None, scenario="broad-selloff", overrides=None, target="20", custom_holdings=None, proxies=None):
        histories = histories if histories is not None else {"ALPHA.NS": history(), "BETA.NS": history(multiplier=2)}
        return run_portfolio_stress(custom_holdings or holdings(), scenario, overrides, target,
                                    lambda symbol: histories.get(symbol, pd.DataFrame()), proxies)

    def test_all_paths_and_figures_reproduce_exactly(self):
        first, second = self.analyze(), self.analyze()
        first.pop("checkedAt")
        second.pop("checkedAt")
        self.assertEqual(first, second)
        monte = first["monteCarlo"]
        self.assertEqual(monte["status"], "complete")
        self.assertEqual(monte["historyKind"], "observed")
        self.assertEqual(len(monte["paths"]), 1000)
        self.assertTrue(all(len(path["valuesInr"]) == 253 for path in monte["paths"]))
        self.assertTrue(all(path["valuesInr"][0] == first["portfolioValueInr"] for path in monte["paths"]))
        self.assertEqual([p["percentile"] for p in monte["terminalPercentiles"]], [5, 50, 95])
        self.assertLess(len(json.dumps(first)), 8 * 1024 * 1024)
        self.assertAlmostEqual(first["reverseStress"]["lossPct"], 20, places=5)
        # Same source returns across both assets mean their price ratio is retained by joint sampling.
        self.assertAlmostEqual(first["scenario"]["lossPct"], 16.25)

    def test_buy_and_hold_paths_match_sampled_asset_compounding_not_rebalancing(self):
        one, two = history(), history()
        two["Adj Close"] = two["Adj Close"].iloc[0] * np.cumprod(1 + np.array([0.03 if i % 3 == 0 else -0.015 for i in range(len(two))]))
        result = self.analyze({"ALPHA.NS": one, "BETA.NS": two})
        series = [{timestamp.date().isoformat(): float(row["Adj Close"]) for timestamp, row in df.iterrows()} for df in (one, two)]
        rows, starts, _ = joint_returns(series, 20)
        indices = block_indices(len(rows), starts, result["monteCarlo"]["config"])
        values = np.array([one["Adj Close"].iloc[-1] * 2, two["Adj Close"].iloc[-1] * 3])
        expected = np.cumprod(1 + rows[indices[0]], axis=0) @ values
        self.assertEqual(result["monteCarlo"]["paths"][0]["valuesInr"][-1], round(float(expected[-1]), 2))

    def test_insufficient_history_has_no_invented_paths_but_can_show_hypothetical_shock(self):
        result = self.analyze({"ALPHA.NS": history(100), "BETA.NS": history(100)})
        self.assertEqual(result["monteCarlo"]["status"], "unavailable")
        self.assertEqual(result["monteCarlo"]["paths"], [])
        self.assertEqual(result["scenario"]["status"], "available")
        missing = self.analyze({})
        self.assertEqual(missing["scenario"]["status"], "unavailable")
        self.assertIsNone(missing["portfolioValueInr"])
        self.assertEqual(missing["reverseStress"]["status"], "unavailable")

    def test_gaps_are_excluded_and_status_is_incomplete(self):
        beta = history().drop(history().index[70])
        result = self.analyze({"ALPHA.NS": history(), "BETA.NS": beta})
        self.assertEqual(result["monteCarlo"]["status"], "incomplete")
        self.assertEqual(result["monteCarlo"]["excludedIntervalCount"], 2)
        self.assertEqual(result["monteCarlo"]["instruments"][1]["missingAlignedObservations"], 1)
        self.assertEqual(len(result["monteCarlo"]["paths"]), 1000)

    def test_fragmented_history_with_no_joint_block_is_unavailable(self):
        beta = history(400).drop(history(400).index[::15])
        result = self.analyze({"ALPHA.NS": history(400), "BETA.NS": beta})
        self.assertGreater(result["monteCarlo"]["validReturnCount"], 252)
        self.assertEqual(result["monteCarlo"]["eligibleBlockCount"], 0)
        self.assertEqual(result["monteCarlo"]["paths"], [])

    def test_proxy_returns_are_labeled_but_index_levels_never_value_stock(self):
        full = history()
        recent = full.iloc[-10:].copy()
        recent["Adj Close"] *= 7
        portfolio = [holdings()[0]]
        mapping = {("NSE", "ALPHA"): {"yahooSymbol": "^TEST", "label": "Test sector index (artificial fixture)"}}
        result = self.analyze({"ALPHA.NS": recent, "^TEST": full}, custom_holdings=portfolio, proxies=mapping)
        self.assertEqual(result["monteCarlo"]["historyKind"], "proxy")
        self.assertEqual(result["monteCarlo"]["status"], "incomplete")
        self.assertEqual(result["monteCarlo"]["instruments"][0]["dataType"], "proxy")
        self.assertEqual(result["portfolioValueInr"], round(float(recent["Adj Close"].iloc[-1] * 2), 2))
        missing = self.analyze({"^TEST": full}, custom_holdings=portfolio, proxies=mapping)
        self.assertIsNone(missing["portfolioValueInr"])
        self.assertEqual(missing["monteCarlo"]["paths"], [])
        etf = [{**portfolio[0], "instrumentType": "etf"}]
        result = self.analyze({"ALPHA.NS": recent, "^TEST": full}, custom_holdings=etf, proxies=mapping)
        self.assertEqual(result["monteCarlo"]["paths"], [])
        self.assertNotEqual(result["monteCarlo"]["instruments"][0]["dataType"], "proxy")

    def test_returns_never_extend_beyond_observed_valuation_date(self):
        full = history(400)
        recent = full.iloc[250:280]
        mapping = {("NSE", "ALPHA"): {"yahooSymbol": "^TEST", "label": "Test sector index (artificial fixture)"}}
        result = self.analyze({"ALPHA.NS": recent, "^TEST": full}, custom_holdings=[holdings()[0]], proxies=mapping)
        self.assertEqual(result["monteCarlo"]["coverageEnd"], result["valuationDate"])
        self.assertEqual(result["monteCarlo"]["validReturnCount"], 279)

    def test_invalid_inputs_never_fetch(self):
        def fetcher(_):
            self.fail("Invalid input must not fetch market history")
        for scenario, overrides, target in [("unknown", None, "20"), ("broad-selloff", {"stockShockPct": "NaN"}, "20"), ("broad-selloff", None, "100")]:
            with self.assertRaises(PortfolioInputError):
                run_portfolio_stress(holdings(), scenario, overrides, target, fetcher)
        with self.assertRaises(PortfolioInputError):
            run_portfolio_stress([{**holdings()[0], "quantity": "-1"}], "broad-selloff", history_fetcher=fetcher)

    def test_current_tmpv_does_not_inherit_pre_symbol_training_data(self):
        result = self.analyze({"TMPV.NS": history()}, custom_holdings=[{**holdings()[0], "ticker": "TMPV"}])
        self.assertIsNone(result["portfolioValueInr"])
        self.assertEqual(result["monteCarlo"]["validReturnCount"], 0)
        self.assertEqual(result["monteCarlo"]["paths"], [])

    def test_clamped_shocks_are_the_actual_shocks_used_for_impacts(self):
        result = self.analyze(overrides={"stockShockPct": "-200", "etfShockPct": "-200"})
        self.assertEqual(result["scenario"]["lossPct"], 95)
        self.assertEqual(len(result["scenario"]["adjustments"]), 2)
        self.assertTrue(all(item["shockPct"] == -95 for item in result["scenario"]["holdings"]))

    def test_reverse_stress_floor_unreachable_target_and_positive_pattern(self):
        hs, values = holdings(), [100, 100]
        result = reverse_stress(hs, values, [-20, -10], 60)
        self.assertEqual(result["status"], "available")
        self.assertAlmostEqual(result["lossPct"], 60, places=5)
        self.assertGreaterEqual(min(row["shockPct"] for row in result["holdings"]), -95)
        self.assertEqual(reverse_stress(hs, values, [-20, 0], 60)["status"], "unavailable")
        self.assertEqual(reverse_stress(hs, values, [-20, -10], 96)["status"], "unavailable")
        self.assertEqual(reverse_stress(hs, values, [-20, 10], 20)["status"], "unavailable")
        tiny = reverse_stress(hs, values, [-1e-100, -20], 20)
        self.assertAlmostEqual(tiny["lossPct"], 20, places=5)
        boundary = reverse_stress(hs, [99.2193, 197.6239], [-20, -10], 95)
        self.assertEqual(boundary["status"], "available")
        self.assertEqual(boundary["lossPct"], 95)


if __name__ == "__main__":
    unittest.main()
