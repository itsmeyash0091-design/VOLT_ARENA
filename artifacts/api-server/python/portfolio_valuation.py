"""Observed-close valuation, separate from adjusted-return analysis."""
from __future__ import annotations

import math
from typing import Any

import pandas as pd


def value_portfolio(holdings: list[dict[str, Any]], histories: list[Any]) -> dict[str, Any]:
    from engine import OBSERVED_SYMBOL_STARTS, _date_string, _finite_price

    series: list[dict[str, float]] = []
    for holding, history in zip(holdings, histories):
        prices: dict[str, float] = {}
        duplicates: set[str] = set()
        seen: set[str] = set()
        if isinstance(history, pd.DataFrame) and not history.empty:
            frame = history.copy()
            if isinstance(frame.columns, pd.MultiIndex):
                frame.columns = frame.columns.get_level_values(0)
            boundary = OBSERVED_SYMBOL_STARTS.get((holding["ticker"], holding["exchange"]))
            for index, row in frame.iterrows():
                try:
                    date = _date_string(index)
                except (TypeError, ValueError):
                    continue
                if boundary and date < boundary[0]:
                    continue
                if date in seen:
                    duplicates.add(date)
                seen.add(date)
                price = _finite_price(row.get("Close"))
                if price is not None:
                    prices[date] = price
        series.append({date: price for date, price in sorted(prices.items()) if date not in duplicates})

    common = set.intersection(*(set(s) for s in series)) if series else set()
    date = max(common) if common else None
    rows = []
    for holding, prices in zip(holdings, series):
        selected_date = date or (max(prices) if prices else None)
        price = prices.get(selected_date) if selected_date else None
        value = price * float(holding["quantity"]) if price is not None else None
        if value is not None and not math.isfinite(value):
            value = None
        rows.append({
            "ticker": holding["ticker"], "exchange": holding["exchange"],
            "instrumentType": holding["instrumentType"], "quantity": float(holding["quantity"]),
            "priceInr": price, "asOfDate": selected_date, "valueInr": value,
            "weightPct": None,
            "reason": None if value is not None else "No usable observed Close for this holding.",
        })
    complete = date is not None and all(r["valueInr"] is not None for r in rows)
    try:
        total = math.fsum(r["valueInr"] for r in rows) if complete else None
    except OverflowError:
        total = None
        complete = False
    if total is not None and (not math.isfinite(total) or total <= 0):
        total, complete = None, False
    allocations = []
    if complete:
        for row in rows:
            row["weightPct"] = row["valueInr"] / total * 100
        for instrument_type in ("stock", "etf"):
            amount = math.fsum(r["valueInr"] for r in rows if r["instrumentType"] == instrument_type)
            allocations.append({"instrumentType": instrument_type, "valueInr": amount, "weightPct": amount / total * 100})
    return {
        "status": "complete" if complete else "unavailable",
        "asOfDate": date if complete else None, "totalValueInr": total,
        "holdings": rows, "allocations": allocations,
        "reason": None if complete else "A total requires usable observed Close prices for every holding on one common date. Individual available values are not a complete portfolio total.",
        "notes": [
            "Quantity multiplied by observed, unadjusted Yahoo Close in INR on the latest common available date. No prices are filled or proxied.",
            "This is a close-price snapshot, not a live quote, cost basis, profit/loss or adjusted total-return valuation. Prices and corporate actions are not independently audited.",
            "Short history may still support a valuation but remain insufficient for risk analysis. Check each holding's history report and valuation date.",
        ],
    }
