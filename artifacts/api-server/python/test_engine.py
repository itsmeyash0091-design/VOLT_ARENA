from __future__ import annotations

import unittest
from unittest.mock import Mock

import pandas as pd

from engine import (
    CONFIGURED_UNIVERSE,
    PortfolioInputError,
    _history_report,
    inspect_portfolio,
    preview_csv,
    validate_holdings,
)


def holding(
    ticker: str = "TMPV",
    exchange: str = "NSE",
    instrument_type: str = "stock",
    quantity: str = "12",
) -> dict[str, str]:
    return {
        "ticker": ticker,
        "exchange": exchange,
        "instrumentType": instrument_type,
        "quantity": quantity,
    }


def sample_history() -> pd.DataFrame:
    index = pd.DatetimeIndex(
        ["2024-01-02", "2024-01-03", "2024-01-10", "2024-01-11"],
        tz="Asia/Kolkata",
    )
    return pd.DataFrame(
        {
            "Close": [100.0, 50.0, 51.0, 52.0],
            "Adj Close": [100.0, 101.0, 102.0, 130.0],
            "Dividends": [0.0, 0.0, 0.0, 0.0],
            "Stock Splits": [0.0, 2.0, 0.0, 0.0],
        },
        index=index,
    )


class CsvPreviewTests(unittest.TestCase):
    def test_preview_suggests_columns_and_preserves_rows(self) -> None:
        preview = preview_csv(
            "Symbol,Qty,Exchange,Asset Type\nTMPV,10,NSE,stock\nETERNAL,2,BSE,etf\n"
        )
        self.assertEqual(preview["rowCount"], 2)
        self.assertEqual(preview["rows"][0]["cells"], ["TMPV", "10", "NSE", "stock"])
        self.assertEqual(preview["suggestedMapping"]["tickerColumn"], "Symbol")
        self.assertEqual(preview["suggestedMapping"]["quantityColumn"], "Qty")
        self.assertEqual(preview["suggestedMapping"]["exchangeColumn"], "Exchange")
        self.assertEqual(preview["suggestedMapping"]["instrumentTypeColumn"], "Asset Type")

    def test_quoted_commas_are_not_split_into_extra_cells(self) -> None:
        preview = preview_csv('Ticker,Quantity,Note\nTMPV,10,"held, long term"\n')
        self.assertEqual(preview["rows"][0]["cells"], ["TMPV", "10", "held, long term"])

    def test_ragged_rows_are_rejected_instead_of_padded(self) -> None:
        with self.assertRaises(PortfolioInputError) as raised:
            preview_csv("Ticker,Quantity\nTMPV,2,extra\n")
        self.assertEqual(raised.exception.issues[0]["code"], "column_count_mismatch")

    def test_csv_limits_are_explicit(self) -> None:
        with self.assertRaises(PortfolioInputError):
            preview_csv("Ticker,Quantity\n" + "TMPV,1\n" * 51)
        with self.assertRaises(PortfolioInputError):
            preview_csv("x" * 80_001)


class PortfolioValidationTests(unittest.TestCase):
    def test_valid_holding_is_normalized_without_market_fetch(self) -> None:
        result = validate_holdings([holding("tmpv.ns", quantity="1,250.5")])
        self.assertTrue(result["valid"])
        self.assertEqual(result["holdings"][0]["ticker"], "TMPV")
        self.assertEqual(result["holdings"][0]["yahooSymbol"], "TMPV.NS")
        self.assertEqual(result["holdings"][0]["quantity"], 1250.5)

    def test_invalid_quantities_and_tickers_are_reported_by_row(self) -> None:
        result = validate_holdings(
            [
                holding(quantity="0"),
                holding(ticker="BAD TICKER", quantity="abc"),
                holding(ticker="VEDL", quantity="-5"),
            ]
        )
        self.assertFalse(result["valid"])
        self.assertEqual([issue["row"] for issue in result["issues"]], [1, 2, 3])
        self.assertEqual(
            {issue["code"] for issue in result["issues"]},
            {"invalid_quantity", "invalid_ticker"},
        )

    def test_duplicate_ticker_on_same_exchange_is_rejected(self) -> None:
        result = validate_holdings([holding(), holding(quantity="2")])
        self.assertFalse(result["valid"])
        self.assertEqual(result["issues"][0]["code"], "duplicate_ticker")

    def test_invalid_input_prevents_any_market_data_request(self) -> None:
        fetcher = Mock()
        with self.assertRaises(PortfolioInputError):
            inspect_portfolio([holding(quantity="NaN")], history_fetcher=fetcher)
        fetcher.assert_not_called()


class MarketHistoryReportTests(unittest.TestCase):
    def test_report_exposes_coverage_gaps_jumps_and_split_actions(self) -> None:
        report = _history_report(
            {
                "ticker": "TMPV",
                "exchange": "NSE",
                "instrumentType": "stock",
                "yahooSymbol": "TMPV.NS",
            },
            sample_history(),
        )
        self.assertEqual(report["status"], "success")
        self.assertEqual(report["coverageStart"], "2024-01-02")
        self.assertEqual(report["coverageEnd"], "2024-01-11")
        self.assertEqual(report["dataType"], "insufficient")
        self.assertEqual(report["splits"][0]["ratio"], 2.0)
        self.assertTrue(report["calendarGaps"])
        self.assertEqual(report["suspiciousJumps"][0]["date"], "2024-01-11")
        self.assertIn("not independently verified", " ".join(report["adjustmentConcerns"]))

    def test_exchange_timezone_date_is_not_shifted_to_utc_previous_day(self) -> None:
        report = _history_report(
            {
                "ticker": "TMPV",
                "exchange": "NSE",
                "instrumentType": "stock",
                "yahooSymbol": "TMPV.NS",
            },
            sample_history(),
        )
        self.assertEqual(report["coverageStart"], "2024-01-02")

    def test_tmpv_pre_symbol_history_is_not_reported_as_tmpv(self) -> None:
        history = pd.DataFrame(
            {
                "Close": [100.0, 101.0],
                "Adj Close": [100.0, 101.0],
                "Dividends": [0.0, 0.0],
                "Stock Splits": [0.0, 0.0],
            },
            index=pd.DatetimeIndex(
                ["2025-10-23", "2025-10-24"],
                tz="Asia/Kolkata",
            ),
        )
        report = _history_report(
            {
                "ticker": "TMPV",
                "exchange": "NSE",
                "instrumentType": "stock",
                "yahooSymbol": "TMPV.NS",
            },
            history,
        )
        self.assertEqual(report["coverageStart"], "2025-10-24")
        self.assertEqual(report["observationCount"], 1)
        self.assertTrue(
            any("Pre-change data is not treated as observed TMPV history" in note
                for note in report["adjustmentConcerns"])
        )

    def test_missing_adjusted_prices_are_not_filled_or_proxied(self) -> None:
        history = sample_history().iloc[:2].copy()
        history["Adj Close"] = [float("nan"), float("nan")]
        report = _history_report(
            {
                "ticker": "NYKAA",
                "exchange": "NSE",
                "instrumentType": "stock",
                "yahooSymbol": "NYKAA.NS",
            },
            history,
        )
        self.assertEqual(report["status"], "skipped")
        self.assertEqual(report["dataType"], "insufficient")
        self.assertEqual(report["missingAdjustedCloseCount"], 2)
        self.assertIsNone(report["proxyInstrument"])
        self.assertIn("No usable adjusted-close", report["skipReason"])

    def test_failed_symbol_is_reported_without_substituting_prices(self) -> None:
        report = inspect_portfolio(
            [holding("NOTAREALSYMBOL")],
            history_fetcher=lambda _: pd.DataFrame(),
        )
        instrument = report["instruments"][0]
        self.assertEqual(instrument["status"], "skipped")
        self.assertEqual(instrument["skipReason"], "Yahoo Finance returned no daily history for this symbol and exchange.")
        self.assertIsNone(instrument["proxyInstrument"])
        self.assertEqual(report["summary"]["skipped"], 1)

    def test_configured_universe_contains_requested_examples(self) -> None:
        self.assertEqual(
            {item["ticker"] for item in CONFIGURED_UNIVERSE},
            {"TMPV", "ETERNAL", "VEDL", "PAYTM", "NYKAA"},
        )

    def test_inspection_preserves_input_order_when_fetches_finish_out_of_order(self) -> None:
        def fetcher(symbol: str) -> pd.DataFrame:
            if symbol.startswith("VEDL"):
                return sample_history().iloc[:2]
            return sample_history()

        report = inspect_portfolio(
            [holding("TMPV"), holding("VEDL")],
            history_fetcher=fetcher,
        )
        self.assertEqual(
            [item["ticker"] for item in report["instruments"]],
            ["TMPV", "VEDL"],
        )


if __name__ == "__main__":
    unittest.main()
