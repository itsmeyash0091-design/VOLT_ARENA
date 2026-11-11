from __future__ import annotations

import unittest
from datetime import date
from typing import Callable

import pandas as pd

from engine import PortfolioInputError
from risk_analysis import analyze_portfolio_risk


def fixture_history(
    start: str = "2020-01-20",
    end: str = "2021-12-31",
    price_for_day: Callable[[date, int], float] | None = None,
    missing_dates: set[str] | None = None,
) -> pd.DataFrame:
    dates = pd.date_range(start, end, freq="B", tz="Asia/Kolkata")
    excluded = missing_dates or set()
    rows = []
    index = []
    for offset, timestamp in enumerate(dates):
        day = timestamp.date()
        iso_day = day.isoformat()
        if iso_day in excluded:
            continue
        price = price_for_day(day, offset) if price_for_day else 100 + offset * 0.1
        rows.append(
            {
                "Close": price,
                "Adj Close": price,
                "Dividends": 0.0,
                "Stock Splits": 0.0,
            }
        )
        index.append(timestamp)
    return pd.DataFrame(rows, index=pd.DatetimeIndex(index))


def recovering_price(day: date, offset: int) -> float:
    special = {
        "2020-01-20": 100.0,
        "2020-01-21": 110.0,
        "2020-01-22": 95.0,
        "2020-01-23": 80.0,
        "2020-01-24": 85.0,
        "2020-01-27": 90.0,
        "2020-01-28": 110.0,
    }
    return special.get(day.isoformat(), 110.0 + (offset % 7) * 0.25)


def nonrecovering_price(day: date, offset: int) -> float:
    special = {
        "2020-01-20": 100.0,
        "2020-01-21": 110.0,
        "2020-01-22": 95.0,
        "2020-01-23": 80.0,
    }
    return special.get(day.isoformat(), 80.0 + (offset % 7) * 0.1)


def two_holdings() -> list[dict[str, str]]:
    return [
        {"ticker": "ALPHA", "exchange": "NSE", "instrumentType": "stock", "quantity": "1"},
        {"ticker": "BETA", "exchange": "NSE", "instrumentType": "stock", "quantity": "2"},
    ]


class PortfolioRiskAnalysisTests(unittest.TestCase):
    def run_analysis(
        self,
        holdings: list[dict[str, str]],
        histories: dict[str, pd.DataFrame],
        proxy_mapping: dict[tuple[str, str], dict[str, str]] | None = None,
    ) -> dict:
        def fetcher(symbol: str) -> pd.DataFrame:
            return histories.get(symbol, pd.DataFrame())

        return analyze_portfolio_risk(holdings, fetcher, proxy_mapping)

    def test_risk_and_replay_results_are_deterministic(self) -> None:
        history = fixture_history(price_for_day=recovering_price)
        report_a = self.run_analysis(
            two_holdings(),
            {"ALPHA.NS": history, "BETA.NS": history * 1.01},
        )
        report_b = self.run_analysis(
            two_holdings(),
            {"ALPHA.NS": history, "BETA.NS": history * 1.01},
        )
        report_a.pop("checkedAt")
        report_b.pop("checkedAt")
        self.assertEqual(report_a, report_b)

        covid = next(window for window in report_a["replayWindows"] if window["id"] == "covid-selloff")
        self.assertEqual(covid["status"], "complete")
        self.assertEqual(covid["recoveryStatus"], "recovered")
        self.assertEqual(covid["recoveryTradingDays"], 3)
        self.assertEqual(covid["path"][0]["normalizedValueIndex"], 100.0)
        self.assertEqual(report_a["riskContribution"]["status"], "complete")
        self.assertGreater(report_a["riskContribution"]["annualizedVolatilityPct"], 0)
        self.assertAlmostEqual(
            sum(row["contributionPct"] for row in report_a["riskContribution"]["contributions"]),
            100.0,
            places=3,
        )

    def test_uncovered_crash_window_is_unavailable_without_fabrication(self) -> None:
        history = fixture_history(price_for_day=recovering_price)
        report = self.run_analysis(
            [{"ticker": "ALPHA", "exchange": "NSE", "instrumentType": "stock", "quantity": "1"}],
            {"ALPHA.NS": history},
        )
        gfc = next(window for window in report["replayWindows"] if window["id"] == "global-financial-crisis")
        self.assertEqual(gfc["status"], "unavailable")
        self.assertEqual(gfc["path"], [])
        self.assertIsNone(gfc["maxDrawdownPct"])
        self.assertEqual(gfc["instruments"][0]["dataType"], "insufficient")

    def test_tmpv_pre_symbol_rows_are_not_used_by_stage2(self) -> None:
        history = fixture_history(start="2020-01-20", end="2020-12-31", price_for_day=recovering_price)
        report = self.run_analysis(
            [{"ticker": "TMPV", "exchange": "NSE", "instrumentType": "stock", "quantity": "1"}],
            {"TMPV.NS": history},
        )
        covid = next(window for window in report["replayWindows"] if window["id"] == "covid-selloff")
        self.assertEqual(covid["status"], "unavailable")
        self.assertEqual(covid["instruments"][0]["observationCount"], 0)
        self.assertIn("No documented sector-index proxy is configured", covid["instruments"][0]["note"])
        self.assertEqual(report["riskContribution"]["status"], "unavailable")

    def test_missing_component_date_makes_replay_and_risk_incomplete(self) -> None:
        missing = {"2020-02-10"}
        alpha = fixture_history(price_for_day=recovering_price)
        beta = fixture_history(price_for_day=recovering_price, missing_dates=missing)
        report = self.run_analysis(
            two_holdings(),
            {"ALPHA.NS": alpha, "BETA.NS": beta},
        )
        covid = next(window for window in report["replayWindows"] if window["id"] == "covid-selloff")
        self.assertEqual(covid["status"], "incomplete")
        self.assertTrue(any("lack one or more holding prices" in note for note in covid["notes"]))
        self.assertEqual(report["riskContribution"]["status"], "incomplete")
        self.assertIsNotNone(report["riskContribution"]["annualizedVolatilityPct"])
        self.assertEqual(
            report["riskContribution"]["instruments"][1]["missingAlignedObservations"],
            1,
        )

    def test_available_history_can_end_without_recovery(self) -> None:
        history = fixture_history(end="2020-12-31", price_for_day=nonrecovering_price)
        report = self.run_analysis(
            [{"ticker": "ALPHA", "exchange": "NSE", "instrumentType": "stock", "quantity": "1"}],
            {"ALPHA.NS": history},
        )
        covid = next(window for window in report["replayWindows"] if window["id"] == "covid-selloff")
        self.assertEqual(covid["recoveryStatus"], "not_recovered")
        self.assertIsNone(covid["recoveryTradingDays"])
        self.assertTrue(any("Not recovered in available history." == note for note in covid["notes"]))

    def test_configured_proxy_is_labeled_and_never_called_observed_stock_data(self) -> None:
        history = fixture_history(price_for_day=recovering_price)
        report = self.run_analysis(
            [{"ticker": "ALPHA", "exchange": "NSE", "instrumentType": "stock", "quantity": "1"}],
            {"NIFTYIT.NS": history},
            {
                ("NSE", "ALPHA"): {
                    "yahooSymbol": "NIFTYIT.NS",
                    "label": "NIFTY IT Index",
                }
            },
        )
        covid = next(window for window in report["replayWindows"] if window["id"] == "covid-selloff")
        self.assertEqual(covid["instruments"][0]["dataType"], "proxy")
        self.assertEqual(covid["instruments"][0]["proxyInstrument"], "NIFTY IT Index")
        self.assertIn("not an observed stock price series", covid["instruments"][0]["note"])
        self.assertEqual(
            report["riskContribution"]["instruments"][0]["dataType"],
            "proxy",
        )

    def test_etf_is_not_proxied_even_when_mapping_is_supplied(self) -> None:
        report = self.run_analysis(
            [{"ticker": "ALPHA", "exchange": "NSE", "instrumentType": "etf", "quantity": "1"}],
            {},
            {
                ("NSE", "ALPHA"): {
                    "yahooSymbol": "NIFTYIT.NS",
                    "label": "NIFTY IT Index",
                }
            },
        )
        covid = next(window for window in report["replayWindows"] if window["id"] == "covid-selloff")
        self.assertEqual(covid["status"], "unavailable")
        self.assertEqual(covid["instruments"][0]["dataType"], "insufficient")
        self.assertIsNone(covid["instruments"][0]["proxyInstrument"])
        self.assertEqual(report["riskContribution"]["status"], "unavailable")

    def test_invalid_input_does_not_fetch_history(self) -> None:
        called = False

        def fetcher(_symbol: str) -> pd.DataFrame:
            nonlocal called
            called = True
            return pd.DataFrame()

        with self.assertRaises(PortfolioInputError):
            analyze_portfolio_risk(
                [{"ticker": "ALPHA", "exchange": "NSE", "instrumentType": "stock", "quantity": "-1"}],
                fetcher,
            )
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()
