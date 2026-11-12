from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

import pandas as pd
import yfinance as yf
from demo_market import snapshot_note

SOURCE = "Yahoo Finance via yfinance (prototype; bundled dated snapshots for demo symbols)"
SOURCE_NOTE = (
    "Free prototype data only; Yahoo Finance history is not official, "
    "real-time, guaranteed complete, or independently audited. " + snapshot_note()
)
MAX_HOLDINGS = 50
MAX_CSV_CHARS = 80_000
MAX_CSV_ROWS = 50
MIN_HISTORY_OBSERVATIONS = 252
SUSPICIOUS_ADJUSTED_MOVE_PCT = 20.0
RAW_CLOSE_CONCERN_PCT = 50.0
CALENDAR_GAP_DAYS = 5
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.&_-]{0,19}$")
OBSERVED_SYMBOL_STARTS = {
    ("TMPV", "NSE"): ("2025-10-24", "NSE circular CML70875; the symbol changed from TATAMOTORS."),
}

CONFIGURED_UNIVERSE = [
    {"ticker": "TMPV", "exchange": "NSE", "instrumentType": "stock"},
    {"ticker": "ETERNAL", "exchange": "NSE", "instrumentType": "stock"},
    {"ticker": "VEDL", "exchange": "NSE", "instrumentType": "stock"},
    {"ticker": "PAYTM", "exchange": "NSE", "instrumentType": "stock"},
    {"ticker": "NYKAA", "exchange": "NSE", "instrumentType": "stock"},
]


class PortfolioInputError(Exception):
    def __init__(self, message: str, issues: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.message = message
        self.issues = issues or []


def _error(message: str, row: int = 1, code: str = "invalid_input") -> PortfolioInputError:
    return PortfolioInputError(
        message,
        [{"row": row, "code": code, "message": message}],
    )


def _suggested_column(columns: list[str], aliases: set[str]) -> str | None:
    for column in columns:
        normalized = re.sub(r"[^a-z0-9]", "", column.lower())
        if normalized in aliases:
            return column
    return None


def preview_csv(csv_text: Any) -> dict[str, Any]:
    if not isinstance(csv_text, str) or not csv_text.strip():
        raise _error("Choose a non-empty CSV file.", code="empty_csv")
    if len(csv_text) > MAX_CSV_CHARS:
        raise _error("CSV exceeds the 80 KB session limit.", code="csv_too_large")

    try:
        reader = csv.reader(io.StringIO(csv_text.lstrip("\ufeff"), newline=""), strict=True)
        raw_headers = next(reader, None)
        if not raw_headers:
            raise _error("CSV must include a header row.", code="missing_header")
        if len(raw_headers) > 30:
            raise _error("CSV may contain at most 30 columns.", code="too_many_columns")

        columns: list[str] = []
        seen: Counter[str] = Counter()
        for index, raw_header in enumerate(raw_headers, start=1):
            base = raw_header.strip() or f"Column {index}"
            seen[base] += 1
            columns.append(base if seen[base] == 1 else f"{base} ({seen[base]})")

        rows: list[dict[str, Any]] = []
        for logical_row, cells in enumerate(reader, start=2):
            if not cells or all(not cell.strip() for cell in cells):
                continue
            if len(rows) >= MAX_CSV_ROWS:
                raise _error(
                    f"CSV may contain at most {MAX_CSV_ROWS} non-empty rows.",
                    row=logical_row,
                    code="too_many_rows",
                )
            if len(cells) != len(columns):
                raise _error(
                    f"Row {logical_row} has {len(cells)} cells; expected {len(columns)}.",
                    row=logical_row,
                    code="column_count_mismatch",
                )
            rows.append(
                {"rowNumber": logical_row, "cells": [cell.strip() for cell in cells]}
            )
    except csv.Error as exc:
        raise _error("CSV quoting or delimiter format is invalid.", code="malformed_csv") from exc

    suggestions = {
        "tickerColumn": _suggested_column(
            columns, {"ticker", "symbol", "stock", "security", "scrip"}
        ),
        "quantityColumn": _suggested_column(
            columns, {"quantity", "qty", "shares", "units", "holding"}
        ),
        "exchangeColumn": _suggested_column(columns, {"exchange", "market"}),
        "instrumentTypeColumn": _suggested_column(
            columns, {"instrumenttype", "assettype", "type"}
        ),
    }
    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "suggestedMapping": suggestions,
        "note": "CSV is parsed in memory and not saved. Review the preview and map columns before validating.",
    }


def _normalize_ticker(value: Any, exchange: str, row: int) -> tuple[str, str]:
    if not isinstance(value, str):
        raise _error("Ticker must be text.", row=row, code="invalid_ticker")
    ticker = value.strip().upper()
    if ticker.endswith(".NS"):
        if exchange != "NSE":
            raise _error("A .NS ticker must use the NSE exchange.", row=row, code="exchange_mismatch")
        ticker = ticker[:-3]
    elif ticker.endswith(".BO"):
        if exchange != "BSE":
            raise _error("A .BO ticker must use the BSE exchange.", row=row, code="exchange_mismatch")
        ticker = ticker[:-3]
    if not TICKER_RE.fullmatch(ticker):
        raise _error(
            "Ticker must contain 1–20 letters, digits, dots, ampersands, underscores, or hyphens.",
            row=row,
            code="invalid_ticker",
        )
    suffix = "NS" if exchange == "NSE" else "BO"
    return ticker, f"{ticker}.{suffix}"


def validate_holdings(holdings: Any) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    if not isinstance(holdings, list) or not holdings:
        return {
            "valid": False,
            "holdings": [],
            "issues": [{"row": 1, "code": "empty_portfolio", "message": "Add at least one holding."}],
        }
    if len(holdings) > MAX_HOLDINGS:
        return {
            "valid": False,
            "holdings": [],
            "issues": [
                {
                    "row": MAX_HOLDINGS + 1,
                    "code": "too_many_holdings",
                    "message": f"A session may contain at most {MAX_HOLDINGS} holdings.",
                }
            ],
        }

    for row_number, item in enumerate(holdings, start=1):
        if not isinstance(item, dict):
            issues.append(
                {"row": row_number, "code": "invalid_row", "message": "Holding row must be an object."}
            )
            continue

        exchange = str(item.get("exchange", "")).strip().upper()
        if exchange not in {"NSE", "BSE"}:
            issues.append(
                {"row": row_number, "code": "invalid_exchange", "message": "Choose NSE or BSE."}
            )
            continue

        instrument_type = str(item.get("instrumentType", "")).strip().lower()
        if instrument_type not in {"stock", "etf"}:
            issues.append(
                {"row": row_number, "code": "invalid_instrument_type", "message": "Choose stock or ETF."}
            )
            continue

        try:
            ticker, yahoo_symbol = _normalize_ticker(item.get("ticker"), exchange, row_number)
        except PortfolioInputError as exc:
            issues.extend(exc.issues)
            continue

        raw_quantity = item.get("quantity")
        if isinstance(raw_quantity, bool) or raw_quantity is None:
            issues.append(
                {"row": row_number, "code": "invalid_quantity", "message": "Quantity must be a positive number."}
            )
            continue
        try:
            quantity_decimal = Decimal(str(raw_quantity).replace(",", "").strip())
            quantity = float(quantity_decimal)
        except (InvalidOperation, ValueError, OverflowError):
            issues.append(
                {"row": row_number, "code": "invalid_quantity", "message": "Quantity must be a positive number."}
            )
            continue
        if not quantity_decimal.is_finite() or not math.isfinite(quantity) or quantity <= 0:
            issues.append(
                {"row": row_number, "code": "invalid_quantity", "message": "Quantity must be a positive finite number."}
            )
            continue

        key = (exchange, ticker)
        if key in seen:
            issues.append(
                {"row": row_number, "code": "duplicate_ticker", "message": f"{ticker} appears more than once on {exchange}; combine or remove duplicate rows."}
            )
            continue
        seen.add(key)
        normalized.append(
            {
                "ticker": ticker,
                "exchange": exchange,
                "instrumentType": instrument_type,
                "quantity": quantity,
                "yahooSymbol": yahoo_symbol,
            }
        )

    if issues:
        return {"valid": False, "holdings": [], "issues": issues}
    return {"valid": True, "holdings": normalized, "issues": []}


def fetch_history(yahoo_symbol: str) -> pd.DataFrame:
    from demo_market import load_demo_history
    snapshot = load_demo_history(yahoo_symbol)
    if snapshot is not None:
        return snapshot
    return yf.Ticker(yahoo_symbol).history(
        period="max",
        interval="1d",
        auto_adjust=False,
        actions=True,
        repair=False,
        keepna=True,
        timeout=20,
    )


def _date_string(value: Any) -> str:
    timestamp = pd.Timestamp(value)
    return timestamp.date().isoformat()


def _finite_price(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _history_report(
    holding: dict[str, Any],
    history: pd.DataFrame | None,
) -> dict[str, Any]:
    symbol = holding["yahooSymbol"]
    base: dict[str, Any] = {
        "ticker": holding["ticker"],
        "exchange": holding["exchange"],
        "instrumentType": holding["instrumentType"],
        "yahooSymbol": symbol,
        "status": "skipped",
        "skipReason": None,
        "dataType": "insufficient",
        "proxyInstrument": None,
        "proxyStartDate": None,
        "proxyEndDate": None,
        "coverageStart": None,
        "coverageEnd": None,
        "asOfDate": None,
        "observationCount": 0,
        "adjustedCloseCount": 0,
        "missingAdjustedCloseCount": 0,
        "calendarGaps": [],
        "suspiciousJumps": [],
        "splits": [],
        "adjustmentConcerns": [],
    }

    if history is None or not isinstance(history, pd.DataFrame) or history.empty:
        base["skipReason"] = "Yahoo Finance returned no daily history for this symbol and exchange."
        base["adjustmentConcerns"] = [
            "No prices were filled, estimated, or replaced with a proxy."
        ]
        return base

    symbol_start = OBSERVED_SYMBOL_STARTS.get(
        (holding["ticker"], holding["exchange"])
    )
    excluded_symbol_rows = 0
    if symbol_start:
        start_date, source_note = symbol_start
        mask = [_date_string(index) >= start_date for index in history.index]
        excluded_symbol_rows = mask.count(False)
        history = history.loc[mask].copy()
    else:
        start_date = None
        source_note = None

    if history.empty:
        base["skipReason"] = "No daily history is available within the configured current-symbol period."
        base["adjustmentConcerns"] = [
            "No prices were filled, estimated, or replaced with a proxy.",
            (
                f"Yahoo rows before {start_date} were excluded because {source_note}"
                if start_date and source_note
                else "No verified symbol-period history was available."
            ),
        ]
        return base

    if isinstance(history.columns, pd.MultiIndex):
        history = history.copy()
        history.columns = history.columns.get_level_values(0)

    dates: list[str] = []
    rows: list[tuple[str, float | None, float | None, float | None]] = []
    for index, row in history.iterrows():
        try:
            date = _date_string(index)
        except (TypeError, ValueError):
            continue
        close = _finite_price(row.get("Close"))
        adjusted = _finite_price(row.get("Adj Close"))
        split_value = row.get("Stock Splits")
        try:
            split = float(split_value) if pd.notna(split_value) else None
        except (TypeError, ValueError, OverflowError):
            split = None
        rows.append((date, close, adjusted, split))
        dates.append(date)

    base["observationCount"] = len(rows)
    base["missingAdjustedCloseCount"] = sum(1 for _, _, adj, _ in rows if adj is None)

    split_events = [
        {"date": date, "ratio": ratio}
        for date, _, _, ratio in rows
        if ratio is not None and math.isfinite(ratio) and ratio != 0
    ]
    base["splits"] = split_events

    date_counts = Counter(dates)
    duplicate_dates = {date for date, count in date_counts.items() if count > 1}
    usable_adjusted = [
        (date, adjusted)
        for date, _, adjusted, _ in rows
        if adjusted is not None and date not in duplicate_dates
    ]
    usable_adjusted.sort(key=lambda item: item[0])
    base["adjustedCloseCount"] = sum(1 for _, _, adjusted, _ in rows if adjusted is not None)

    concerns = [
        "Adj Close is the source-provided adjusted series; it is not independently verified by this report.",
        "No prices are imputed, estimated, forward-filled, or replaced with a proxy.",
    ]
    if start_date and source_note:
        concerns.append(
            f"Yahoo rows before {start_date} were excluded ({excluded_symbol_rows} row(s)): {source_note} Pre-change data is not treated as observed TMPV history."
        )
    if base["missingAdjustedCloseCount"]:
        concerns.append(
            f"{base['missingAdjustedCloseCount']} returned row(s) have no usable Adj Close; those values were not filled."
        )
    if duplicate_dates:
        concerns.append(
            f"Duplicate date rows were returned for {len(duplicate_dates)} date(s); those dates were excluded from gap and jump checks."
        )
    if split_events:
        concerns.append(
            "Yahoo returned split actions listed below; corporate-action completeness was not independently verified."
        )
    else:
        concerns.append(
            "Yahoo returned no split actions; this does not prove that no corporate actions occurred."
        )

    if not usable_adjusted:
        base["skipReason"] = "No usable adjusted-close observations were returned."
        base["adjustmentConcerns"] = concerns
        return base

    base["coverageStart"] = usable_adjusted[0][0]
    base["coverageEnd"] = usable_adjusted[-1][0]
    base["asOfDate"] = usable_adjusted[-1][0]
    base["status"] = "success"
    base["dataType"] = (
        "observed"
        if len(usable_adjusted) >= MIN_HISTORY_OBSERVATIONS
        else "insufficient"
    )
    if len(usable_adjusted) < MIN_HISTORY_OBSERVATIONS:
        concerns.append(
            f"Only {len(usable_adjusted)} usable adjusted-close observations were returned; fewer than {MIN_HISTORY_OBSERVATIONS} daily observations are available."
        )

    for (previous_date, _), (next_date, _) in zip(usable_adjusted, usable_adjusted[1:]):
        calendar_days = (
            pd.Timestamp(next_date) - pd.Timestamp(previous_date)
        ).days
        if calendar_days > CALENDAR_GAP_DAYS:
            base["calendarGaps"].append(
                {
                    "previousDate": previous_date,
                    "nextDate": next_date,
                    "calendarDays": calendar_days,
                    "note": "Potential calendar gap; exchange holidays are not excluded.",
                }
            )

    for (previous_date, previous_price), (next_date, next_price) in zip(
        usable_adjusted, usable_adjusted[1:]
    ):
        change_pct = (next_price / previous_price - 1.0) * 100.0
        if abs(change_pct) >= SUSPICIOUS_ADJUSTED_MOVE_PCT:
            base["suspiciousJumps"].append(
                {
                    "date": next_date,
                    "priceBasis": "adjusted_close",
                    "percentChange": round(change_pct, 4),
                    "note": (
                        f"Move between consecutive observed rows ({previous_date} to {next_date}); "
                        "review against market and corporate-action records."
                    ),
                }
            )

    raw_close_rows = [
        (date, close)
        for date, close, _, _ in rows
        if close is not None and date not in duplicate_dates
    ]
    raw_close_rows.sort(key=lambda item: item[0])
    split_dates = [event["date"] for event in split_events]
    for (previous_date, previous_close), (next_date, next_close) in zip(
        raw_close_rows, raw_close_rows[1:]
    ):
        move_pct = (next_close / previous_close - 1.0) * 100.0
        near_reported_split = any(
            abs((pd.Timestamp(next_date) - pd.Timestamp(split_date)).days) <= 3
            for split_date in split_dates
        )
        if abs(move_pct) >= RAW_CLOSE_CONCERN_PCT and not near_reported_split:
            concerns.append(
                f"Raw Close moved {move_pct:.2f}% between {previous_date} and {next_date} without a nearby Yahoo split action; verify corporate actions independently."
            )
    base["adjustmentConcerns"] = concerns
    return base


def inspect_portfolio(
    holdings: Any,
    history_fetcher: Callable[[str], pd.DataFrame] | None = None,
) -> dict[str, Any]:
    validation = validate_holdings(holdings)
    if not validation["valid"]:
        raise PortfolioInputError("Portfolio input is invalid.", validation["issues"])

    fetcher = history_fetcher or fetch_history
    results: list[dict[str, Any] | None] = [None] * len(validation["holdings"])
    histories: list[Any] = [None] * len(validation["holdings"])
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(fetcher, holding["yahooSymbol"]): (index, holding)
            for index, holding in enumerate(validation["holdings"])
        }
        for future in as_completed(futures):
            index, holding = futures[future]
            try:
                history = future.result()
                histories[index] = history
                results[index] = _history_report(holding, history)
            except Exception as exc:  # Provider failures are reported per ticker.
                result = _history_report(holding, None)
                result["skipReason"] = (
                    f"Yahoo Finance request failed ({type(exc).__name__}); retry later or verify the symbol."
                )
                result["adjustmentConcerns"] = [
                    "Provider failure; no prices were filled, estimated, or replaced with a proxy."
                ]
                results[index] = result

    instruments = [result for result in results if result is not None]
    succeeded = sum(1 for result in instruments if result["status"] == "success")
    from portfolio_valuation import value_portfolio
    return {
        "source": SOURCE,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "requested": len(instruments),
            "succeeded": succeeded,
            "skipped": len(instruments) - succeeded,
        },
        "instruments": instruments,
        "valuation": value_portfolio(validation["holdings"], histories),
        "dataNotes": [
            SOURCE_NOTE,
            "As-of is the latest date returned by Yahoo; a current-day row may be provisional and is not a verified final exchange close.",
            "History is requested with period=max at daily interval; actual coverage is shown per symbol.",
            f"Potential calendar gaps are gaps longer than {CALENDAR_GAP_DAYS} calendar days; Indian exchange holidays are not excluded.",
            f"Adjusted-close moves of at least {SUSPICIOUS_ADJUSTED_MOVE_PCT:.0f}% between consecutive observed rows are flagged for review, not labeled as confirmed errors.",
            f"Fewer than {MIN_HISTORY_OBSERVATIONS} adjusted-close observations are labeled insufficient; this is a coverage warning, not an analysis result.",
            "Instrument type is user-selected and is not verified against an official exchange security master.",
            "No sector-index proxy is configured in Stage 1. Missing history remains insufficient; ETFs are never proxied.",
        ],
    }


def dispatch(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise _error("Request must be a JSON object.")
    operation = payload.get("operation")
    if operation == "get_market_data_universe":
        return {
            "source": SOURCE,
            "instruments": CONFIGURED_UNIVERSE,
        }
    if operation == "preview_portfolio_csv":
        return preview_csv(payload.get("csvText"))
    if operation == "validate_portfolio":
        return validate_holdings(payload.get("holdings"))
    if operation == "inspect_portfolio":
        return inspect_portfolio(payload.get("holdings"))
    if operation == "analyze_portfolio_risk":
        from risk_analysis import analyze_portfolio_risk

        return analyze_portfolio_risk(payload.get("holdings"))
    if operation == "get_static_scenarios":
        from scenarios import get_library

        return get_library()
    if operation == "run_portfolio_stress":
        from stress_analysis import run_portfolio_stress

        return run_portfolio_stress(
            payload.get("holdings"), payload.get("scenarioId"),
            payload.get("overrides"), payload.get("targetLossPct", "20"),
        )
    if operation == "get_game_settings":
        from resilience import game_settings

        return game_settings()
    if operation == "analyze_resilience":
        from resilience import analyze_resilience

        return analyze_resilience(payload.get("holdings"), {
            key: payload[key] for key in ("confidencePct", "horizonTradingDays", "lossLimitInr", "reflection")
            if key in payload
        })
    raise _error("Unsupported engine operation.", code="unsupported_operation")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        data = dispatch(payload)
        print(json.dumps({"ok": True, "data": data}, allow_nan=False))
        return 0
    except PortfolioInputError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": exc.message,
                    "issues": exc.issues,
                },
                allow_nan=False,
            )
        )
        return 2
    except Exception:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "Python data engine failed.",
                    "issues": [],
                }
            )
        )
        return 1


if __name__ == "__main__":
    # Keep shared engine exceptions/helpers identical when risk_analysis imports this script.
    sys.modules.setdefault("engine", sys.modules[__name__])
    raise SystemExit(main())
