"""Fixtures below are artificial test data, not observed market history."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import numpy as np

from crash_card import build_crash_card
from engine import PortfolioInputError, dispatch
from resilience import analyze_resilience, game_settings, hidden_returns
from stress_analysis import joint_returns
from test_stress_analysis import history, holdings


class ResilienceTests(unittest.TestCase):
    def analyze(self, options=None, histories=None, portfolio=None, mapping=None):
        if histories is None:
            histories = {"ALPHA.NS": history(400), "BETA.NS": history(400, multiplier=2)}
        import pandas as pd
        return analyze_resilience(portfolio or holdings(), options, lambda symbol: histories.get(symbol, pd.DataFrame()), mapping)

    def test_exactly_500_fixed_seed_hidden_outcomes_and_reproducible_scoring(self):
        a, b = self.analyze({"lossLimitInr": "5"}), self.analyze({"lossLimitInr": "5"})
        a.pop("checkedAt"); b.pop("checkedAt")
        self.assertEqual(a, b)
        self.assertEqual(a["evaluatedScenarioCount"], 500)
        self.assertEqual(a["panicGame"]["evaluatedScenarioCount"], 500)
        self.assertEqual(a["settings"]["hiddenScenarioCount"], 500)
        self.assertEqual(a["levels"]["status"], "available", a["levels"]["reason"])
        self.assertEqual(len(a["hiddenScenarioDigest"]), 64)
        self.assertNotIn("outcomes", a)
        self.assertNotIn("paths", a)
        coverage = a["panicGame"]
        self.assertEqual(coverage["coverageScorePct"], coverage["withinLimitCount"] / 500 * 100)
        np.testing.assert_allclose([r["parComponentSharePct"] for r in a["levels"]["holdings"]], [50, 50], atol=.01)

    def test_hidden_sampling_count_joint_order_and_seed_change(self):
        rows = np.column_stack((np.arange(300)/10000, np.arange(300)/10000))
        settings = game_settings()
        sample = hidden_returns(rows, list(range(281)), settings)
        self.assertEqual(sample.shape, (500, 2))
        np.testing.assert_array_equal(sample[:, 0], sample[:, 1])
        np.testing.assert_array_equal(sample, hidden_returns(rows, list(range(281)), settings))
        self.assertFalse(np.array_equal(sample, hidden_returns(rows, list(range(281)), {**settings, "hiddenSeed": settings["hiddenSeed"] + 1})))

    def test_frozen_source_financial_outputs_match_across_fresh_python_processes(self):
        script = """
import json
from test_stress_analysis import history, holdings
from resilience import analyze_resilience
histories = {"ALPHA.NS": history(400), "BETA.NS": history(400, multiplier=2)}
result = analyze_resilience(holdings(), {"lossLimitInr": "5"}, lambda symbol: histories[symbol])
result.pop("checkedAt")
print(json.dumps(result, sort_keys=True))
"""
        outputs = [subprocess.check_output([sys.executable, "-c", script], cwd=Path(__file__).parent, text=True) for _ in range(2)]
        self.assertEqual(outputs[0], outputs[1])

    def test_budget_and_reflections_never_change_levels(self):
        low = self.analyze({"lossLimitInr": "0"})
        high = self.analyze({"lossLimitInr": "100000", "reflection": "pause"})
        self.assertEqual(low["levels"], high["levels"])
        self.assertEqual(low["hiddenScenarioDigest"], high["hiddenScenarioDigest"])
        self.assertLessEqual(low["panicGame"]["coverageScorePct"], high["panicGame"]["coverageScorePct"])
        self.assertEqual(high["panicGame"]["coverageScorePct"], 100)
        self.assertIsNotNone(high["panicGame"]["reflectionFeedback"])
        self.assertEqual(low["crashCard"], high["crashCard"])

    def test_configurable_cvar_defaults_and_horizon(self):
        default = self.analyze()
        different_confidence = self.analyze({"confidencePct": "90"})
        different_horizon = self.analyze({"horizonTradingDays": "5"})
        self.assertEqual(default["settings"]["confidencePct"], 95)
        self.assertEqual(default["settings"]["horizonTradingDays"], 1)
        self.assertEqual(default["hiddenScenarioDigest"], different_confidence["hiddenScenarioDigest"])
        self.assertNotEqual(default["hiddenScenarioDigest"], different_horizon["hiddenScenarioDigest"])
        self.assertEqual(different_horizon["evaluatedScenarioCount"], 500)
        self.assertNotEqual(default["levels"]["currentCvarPct"], different_confidence["levels"]["currentCvarPct"])
        self.assertEqual(default["panicGame"]["status"], "ready")
        self.assertIsNone(default["panicGame"]["coverageScorePct"])

    def test_scoring_math_uses_actual_hidden_losses(self):
        result = self.analyze({"lossLimitInr": "3"})
        df = history(400)
        series = {t.date().isoformat(): float(row["Adj Close"]) for t, row in df.iterrows()}
        rows, starts, _ = joint_returns([series, {k: v*2 for k, v in series.items()}], 20)
        outcomes = hidden_returns(rows, starts, result["settings"])
        # Latest values are 2 shares at source price and 3 ETF units at twice that price.
        full_value = float(df["Adj Close"].iloc[-1] * 8)
        weights = np.array([.25, .75])
        losses = -(outcomes @ weights)
        count = int(np.sum(losses * full_value <= 3))
        self.assertEqual(result["panicGame"]["withinLimitCount"], count)
        self.assertAlmostEqual(result["levels"]["scorePct"], min(100, 100/result["levels"]["ratioToPar"]), places=4)

    def test_missing_history_is_unavailable_not_a_sample_score(self):
        result = self.analyze(histories={"ALPHA.NS": history(100), "BETA.NS": history(100)})
        self.assertEqual(result["evaluatedScenarioCount"], 0)
        self.assertEqual(result["levels"]["status"], "unavailable")
        self.assertIsNone(result["levels"]["scorePct"])
        self.assertEqual(result["levels"]["holdings"], [])
        self.assertEqual(result["panicGame"]["status"], "unavailable")
        self.assertIsNone(result["panicGame"]["coverageScorePct"])
        self.assertIn("unavailable", result["crashCard"]["text"])

    def test_failed_par_preserves_known_current_risk_but_not_level(self):
        failed = {"status": "unavailable", "reason": "artificial test failure", "cvar": None}
        with patch("resilience.solve_equal_cvar_par", return_value=failed):
            result = self.analyze({"lossLimitInr": "4"})
        self.assertIsNotNone(result["levels"]["currentCvarInr"])
        self.assertIsNone(result["levels"]["parCvarInr"])
        self.assertIsNone(result["levels"]["level"])
        self.assertEqual(result["levels"]["holdings"], [])
        self.assertEqual(result["evaluatedScenarioCount"], 500)

    def test_proxy_labels_and_observed_valuation_survive_scoring(self):
        full = history(400)
        short = full.iloc[-10:].copy()
        mapping = {("NSE", "ALPHA"): {"yahooSymbol": "^TEST", "label": "Test sector index (artificial fixture)"}}
        result = self.analyze(histories={"ALPHA.NS": short, "^TEST": full}, portfolio=[holdings()[0]], mapping=mapping)
        self.assertEqual(result["historyKind"], "proxy")
        self.assertEqual(result["coverageStatus"], "incomplete")
        self.assertEqual(result["instruments"][0]["dataType"], "proxy")
        self.assertIn("proxy", result["crashCard"]["text"])
        self.assertEqual(result["evaluatedScenarioCount"], 500)

    def test_invalid_options_do_not_fetch(self):
        def forbidden(_):
            self.fail("Invalid requests must not fetch source data")
        cases = [{"confidencePct": "100"}, {"confidencePct": "NaN"}, {"horizonTradingDays": "0"},
                 {"horizonTradingDays": "1.5"}, {"horizonTradingDays": "253"}, {"lossLimitInr": "-1"},
                 {"lossLimitInr": "inf"}, {"reflection": "trade"}, {"reflection": "pause"}]
        for options in cases:
            with self.subTest(options=options), self.assertRaises(PortfolioInputError):
                analyze_resilience(holdings(), options, forbidden)
        self.assertEqual(dispatch({"operation": "get_game_settings"}), game_settings())

    def test_no_silent_hidden_count_or_tolerance_changes(self):
        for field, value in [("hiddenScenarioCount", 499), ("hiddenSeed", -1), ("componentShareTolerance", .01)]:
            data = game_settings()
            data[field] = value
            with patch("resilience.SETTINGS_PATH") as path:
                path.read_text.return_value = json.dumps(data)
                with self.assertRaises(ValueError):
                    game_settings()

    def test_zero_risk_scenarios_never_get_a_level_or_replacement_benchmark(self):
        df = history(400)
        df["Adj Close"] = 100.0
        result = self.analyze({"lossLimitInr": "0"}, histories={"ALPHA.NS": df, "BETA.NS": df})
        self.assertEqual(result["evaluatedScenarioCount"], 500)
        self.assertEqual(result["levels"]["status"], "unavailable")
        self.assertIsNone(result["levels"]["scorePct"])
        self.assertIsNone(result["levels"]["parCvarInr"])
        self.assertEqual(result["panicGame"]["withinLimitCount"], 500)


class CrashCardTests(unittest.TestCase):
    def test_template_limits_rupees_first_and_exact_python_values(self):
        card = build_crash_card(1234.56, "2026-11-11", 87.65, 76.54, 98.76, 95, 1, "incomplete observed")
        self.assertTrue(card["text"].startswith("₹1,234.56"))
        self.assertIn("₹87.65", card["findings"][0])
        self.assertIn("₹76.54", card["findings"][1])
        self.assertIn("₹98.76", card["findings"][2])
        self.assertEqual(card["wordCount"], len(card["text"].split()))
        self.assertLess(card["wordCount"], 120)
        self.assertLessEqual(len(card["findings"]), 3)
        self.assertNotRegex(card["text"].lower(), r"\b(buy|sell|rebalance|switch|allocate)\b")
        self.assertIn("not an allocation recommendation", card["text"])
        self.assertIn("Simulated outcomes are not observed prices", card["text"])
        self.assertEqual(card, build_crash_card(1234.56, "2026-11-11", 87.65, 76.54, 98.76, 95, 1, "incomplete observed"))

    def test_unavailable_gain_and_extreme_formatting_keep_content_limits(self):
        for value, risk, par, worst in [(None, None, None, None), (100, -2, None, -1), (1e30, 1e28, 1e27, 1e29)]:
            card = build_crash_card(value, "2026-11-11", risk, par, worst, 99, 252, "incomplete proxy-labeled")
            self.assertTrue(card["text"].startswith("₹"))
            self.assertLess(card["wordCount"], 120)
            self.assertLessEqual(len(card["findings"]), 3)
            self.assertNotRegex(card["text"].lower(), r"\b(buy|sell|rebalance|switch|allocate)\b")
        self.assertIn("gain", build_crash_card(100, "2026-11-11", -2, None, -1, 95, 1, "observed")["text"])
