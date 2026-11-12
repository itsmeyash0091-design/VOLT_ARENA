"""Artificial fixtures test replay behavior; these are not market observations."""
from __future__ import annotations

import unittest

import pandas as pd

from risk_analysis import REPLAY_WINDOWS, analyze_portfolio_risk


def holding(ticker: str, instrument_type: str = "stock") -> dict:
    return {"ticker": ticker, "exchange": "NSE", "instrumentType": instrument_type, "quantity": "2"}


def history(start: str, end: str) -> pd.DataFrame:
    dates = pd.date_range(start, end, freq="B", tz="Asia/Kolkata")
    prices = [100.0 if i < 5 else 80.0 if i < 10 else 110.0 for i in range(len(dates))]
    return pd.DataFrame({"Close": prices, "Adj Close": prices}, index=dates)


class CrashWindowTests(unittest.TestCase):
    def test_four_distinct_fixed_intervals(self) -> None:
        self.assertEqual(len(REPLAY_WINDOWS), 4)
        self.assertEqual(len({window["id"] for window in REPLAY_WINDOWS}), 4)
        for window in REPLAY_WINDOWS:
            self.assertLess(window["startDate"], window["endDate"])

    def test_added_windows_calculate_from_supplied_observations_deterministically(self) -> None:
        for window_id in ("bombay-bubble", "taper-tantrum"):
            window = next(w for w in REPLAY_WINDOWS if w["id"] == window_id)
            frame = history(window["startDate"], window["endDate"])
            reports = [
                analyze_portfolio_risk([holding("ALPHA")], lambda _: frame)
                for _ in range(2)
            ]
            results = [
                next(w for w in report["replayWindows"] if w["id"] == window_id)
                for report in reports
            ]
            self.assertEqual(results[0], results[1])
            self.assertEqual(results[0]["status"], "complete")
            self.assertAlmostEqual(results[0]["maxDrawdownPct"], -20)
            self.assertEqual(results[0]["path"][0]["portfolioValue"], 200)
            self.assertEqual(results[0]["instruments"][0]["dataType"], "observed")

    def test_recent_history_never_fills_1992_window(self) -> None:
        report = analyze_portfolio_risk(
            [holding("ETF", "etf")], lambda _: history("2020-01-20", "2021-01-20")
        )
        window = next(w for w in report["replayWindows"] if w["id"] == "bombay-bubble")
        self.assertEqual(window["status"], "unavailable")
        self.assertEqual(window["path"], [])
        self.assertIsNone(window["maxDrawdownPct"])
        self.assertIsNone(window["instruments"][0]["proxyInstrument"])

    def test_explicit_subset_does_not_make_full_portfolio_available(self) -> None:
        frame = history("2020-01-20", "2021-01-20")
        fetcher = lambda _: frame
        full_holdings = [holding("ALPHA"), holding("TMPV")]
        full = analyze_portfolio_risk(full_holdings, fetcher)
        subset = analyze_portfolio_risk([full_holdings[0]], fetcher)
        window = lambda report: next(w for w in report["replayWindows"] if w["id"] == "covid-selloff")
        self.assertEqual(window(full)["status"], "unavailable")
        self.assertEqual(window(full)["path"], [])
        self.assertEqual(window(subset)["status"], "complete")
        self.assertEqual([h["ticker"] for h in full_holdings], ["ALPHA", "TMPV"])
        self.assertEqual(window(full)["instruments"][1]["dataType"], "insufficient")


if __name__ == "__main__":
    unittest.main()
