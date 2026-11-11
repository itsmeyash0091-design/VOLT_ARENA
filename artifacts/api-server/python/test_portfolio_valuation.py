"""Artificial fixtures only: never used as displayed market history."""
import unittest

import pandas as pd

from engine import inspect_portfolio
from portfolio_valuation import value_portfolio


def holding(ticker="VEDL", quantity="2", instrument_type="stock"):
    return {"ticker": ticker, "exchange": "NSE", "instrumentType": instrument_type, "quantity": quantity}


def history(prices, dates=None):
    return pd.DataFrame({
        "Close": prices,
        "Adj Close": [1.0] * len(prices),
        "Stock Splits": [0.0] * len(prices),
    }, index=pd.to_datetime(dates or ["2026-11-10", "2026-11-11"][:len(prices)]))


class PortfolioValuationTests(unittest.TestCase):
    def test_observed_raw_close_not_adjusted_and_deterministic(self):
        hs = [holding(), holding("NIFTYBEES", "3", "etf")]
        frames = [history([10., 20.]), history([20., 40.])]
        result = value_portfolio(hs, frames)
        self.assertEqual(result, value_portfolio(hs, frames))
        self.assertEqual(result["totalValueInr"], 160.)
        self.assertEqual(result["asOfDate"], "2026-11-11")
        self.assertEqual([x["weightPct"] for x in result["holdings"]], [25., 75.])
        self.assertEqual([x["valueInr"] for x in result["allocations"]], [40., 120.])

    def test_uses_latest_common_observed_date_without_forward_fill(self):
        result = value_portfolio([holding(), holding("INFY")], [history([10., 20.]), history([30.])])
        self.assertEqual(result["asOfDate"], "2026-11-10")
        self.assertEqual(result["totalValueInr"], 80.)
        self.assertEqual(result["holdings"][0]["priceInr"], 10.)

    def test_missing_holding_never_partial_total_or_weights(self):
        result = value_portfolio([holding(), holding("INFY")], [history([10., 20.]), None])
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["totalValueInr"])
        self.assertEqual(result["holdings"][0]["valueInr"], 40.)
        self.assertIsNone(result["holdings"][0]["weightPct"])
        self.assertEqual(result["allocations"], [])

    def test_no_common_date_does_not_mix_valuation_dates(self):
        result = value_portfolio([holding(), holding("INFY")], [
            history([10.], ["2026-11-10"]), history([30.], ["2026-11-11"]),
        ])
        self.assertIsNone(result["totalValueInr"])
        self.assertIsNone(result["asOfDate"])

    def test_duplicate_dates_excluded_even_if_one_invalid(self):
        result = value_portfolio([holding()], [history([10., float("nan")], ["2026-11-10"] * 2)])
        self.assertIsNone(result["totalValueInr"])

    def test_nonfinite_negative_and_zero_prices_never_used(self):
        for price in (float("inf"), float("nan"), -1., 0.):
            with self.subTest(price=price):
                result = value_portfolio([holding()], [history([price])])
                self.assertIsNone(result["totalValueInr"])

    def test_tmpv_symbol_boundary_applies_to_valuation(self):
        result = value_portfolio([holding("TMPV")], [history([10., 20.], ["2025-10-23", "2025-10-24"])])
        self.assertEqual(result["asOfDate"], "2025-10-24")
        result = value_portfolio([holding("TMPV")], [history([10.], ["2025-10-23"])])
        self.assertIsNone(result["totalValueInr"])

    def test_overflow_unavailable_and_json_safe(self):
        import json
        result = value_portfolio([holding(quantity="1e308")], [history([1e308])])
        self.assertIsNone(result["totalValueInr"])
        json.dumps(result, allow_nan=False)

    def test_inspection_reuses_fetch_once_and_retains_short_history_warning(self):
        calls = []
        def fetch(symbol):
            calls.append(symbol)
            return history([10., 20.])
        result = inspect_portfolio([holding()], fetch)
        self.assertEqual(calls, ["VEDL.NS"])
        self.assertEqual(result["valuation"]["totalValueInr"], 40.)
        self.assertEqual(result["instruments"][0]["dataType"], "insufficient")


if __name__ == "__main__":
    unittest.main()
