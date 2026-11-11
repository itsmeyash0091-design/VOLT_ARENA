from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

import pandas as pd

from engine import (
    OBSERVED_SYMBOL_STARTS,
    SOURCE,
    SOURCE_NOTE,
    _date_string,
    _finite_price,
    fetch_history,
    validate_holdings,
)

# These are fixed historical periods, not user-generated or synthetic scenarios.
REPLAY_WINDOWS = [
    {
        "id": "global-financial-crisis",
        "name": "Global financial crisis",
        "startDate": "2007-10-30",
        "endDate": "2009-03-09",
    },
    {
        "id": "covid-selloff",
        "name": "COVID-19 sell-off",
        "startDate": "2020-01-20",
        "endDate": "2020-03-23",
    },
]

# No stock-to-sector mapping was documented in Stage 1. Never infer one here.
DOCUMENTED_SECTOR_PROXIES: dict[tuple[str, str], dict[str, str]] = {}

MIN_RISK_RETURN_OBSERVATIONS = 60
BOUNDARY_TOLERANCE_DAYS = 7
CALENDAR_GAP_DAYS = 5
ANNUAL_TRADING_DAYS = 252


def _as_price_series(history: pd.DataFrame | None, start_date: str | None = None) -> dict[str, float]:
    if history is None or not isinstance(history, pd.DataFrame) or history.empty:
        return {}
    if isinstance(history.columns, pd.MultiIndex):
        history = history.copy()
        history.columns = history.columns.get_level_values(0)
    if "Adj Close" not in history.columns:
        return {}

    values: dict[str, float] = {}
    for index, row in history.iterrows():
        try:
            date = _date_string(index)
        except (TypeError, ValueError):
            continue
        if start_date and date < start_date:
            continue
        price = _finite_price(row.get("Adj Close"))
        if price is not None and date not in values:
            values[date] = price
    return dict(sorted(values.items()))


def _series_coverage(series: dict[str, float]) -> tuple[str | None, str | None]:
    if not series:
        return None, None
    dates = list(series)
    return dates[0], dates[-1]


def _lookup_proxy(
    holding: dict[str, Any],
    proxy_mapping: dict[tuple[str, str], dict[str, str]],
) -> dict[str, str] | None:
    if holding["instrumentType"] != "stock":
        return None
    return proxy_mapping.get((holding["exchange"], holding["ticker"]))


def _fetch_input_series(
    holdings: list[dict[str, Any]],
    history_fetcher: Callable[[str], pd.DataFrame],
    proxy_mapping: dict[tuple[str, str], dict[str, str]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any] | None] = [None] * len(holdings)
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {
            executor.submit(history_fetcher, holding["yahooSymbol"]): (index, holding)
            for index, holding in enumerate(holdings)
        }
        for future in as_completed(future_map):
            index, holding = future_map[future]
            try:
                history = future.result()
                symbol_start = OBSERVED_SYMBOL_STARTS.get(
                    (holding["ticker"], holding["exchange"])
                )
                cutoff = symbol_start[0] if symbol_start else None
                series = _as_price_series(history, cutoff)
                results[index] = {
                    "holding": holding,
                    "observedSeries": series,
                    "observedError": None if series else "No usable adjusted-close history was returned.",
                    "proxy": _lookup_proxy(holding, proxy_mapping),
                    "proxySeries": {},
                    "proxyError": None,
                }
            except Exception as exc:
                results[index] = {
                    "holding": holding,
                    "observedSeries": {},
                    "observedError": f"Yahoo request failed ({type(exc).__name__}).",
                    "proxy": _lookup_proxy(holding, proxy_mapping),
                    "proxySeries": {},
                    "proxyError": None,
                }

    loaded = [result for result in results if result is not None]
    for item in loaded:
        proxy = item["proxy"]
        if proxy is None:
            continue
        try:
            item["proxySeries"] = _as_price_series(history_fetcher(proxy["yahooSymbol"]))
            if not item["proxySeries"]:
                item["proxyError"] = "The configured sector-index proxy returned no usable adjusted-close history."
        except Exception as exc:
            item["proxyError"] = f"Configured sector-index proxy request failed ({type(exc).__name__})."
    return loaded


def _boundary_complete(
    series: dict[str, float], start_date: str, end_date: str
) -> bool:
    in_window = [date for date in series if start_date <= date <= end_date]
    if len(in_window) < 2:
        return False
    return (
        (pd.Timestamp(in_window[0]) - pd.Timestamp(start_date)).days <= BOUNDARY_TOLERANCE_DAYS
        and (pd.Timestamp(end_date) - pd.Timestamp(in_window[-1])).days <= BOUNDARY_TOLERANCE_DAYS
    )


def _coverage_item(
    item: dict[str, Any],
    series: dict[str, float],
    data_type: str,
    proxy: dict[str, str] | None,
    missing_aligned: int,
    note: str,
) -> dict[str, Any]:
    holding = item["holding"]
    coverage_start, coverage_end = _series_coverage(series)
    source_symbol = proxy["yahooSymbol"] if data_type == "proxy" and proxy else holding["yahooSymbol"]
    return {
        "ticker": holding["ticker"],
        "instrumentType": holding["instrumentType"],
        "dataType": data_type,
        "sourceSymbol": source_symbol if series else None,
        "proxyInstrument": proxy["label"] if data_type == "proxy" and proxy else None,
        "coverageStart": coverage_start,
        "coverageEnd": coverage_end,
        "observationCount": len(series),
        "missingAlignedObservations": missing_aligned,
        "note": note,
    }


def _select_window_series(
    item: dict[str, Any], start_date: str, end_date: str
) -> tuple[dict[str, float], str, dict[str, str] | None, str]:
    observed = item["observedSeries"]
    if _boundary_complete(observed, start_date, end_date):
        return observed, "observed", None, "Observed adjusted-close history covers the requested window."

    proxy = item["proxy"]
    if proxy and _boundary_complete(item["proxySeries"], start_date, end_date):
        return (
            item["proxySeries"],
            "proxy",
            proxy,
            f"Stock history is represented by the documented sector-index proxy {proxy['label']}; this is not an observed stock price series.",
        )

    note = item["observedError"] or "Observed stock/ETF history does not cover the full requested window."
    if proxy and item["proxyError"]:
        note = f"{note} {item['proxyError']}"
    if item["holding"]["instrumentType"] == "etf":
        note = f"{note} ETFs are not proxied."
    return observed, "insufficient", None, note


def _common_dates(series_list: list[dict[str, float]]) -> tuple[list[str], list[str]]:
    if not series_list or any(not series for series in series_list):
        return [], []
    date_sets = [set(series) for series in series_list]
    common = sorted(set.intersection(*date_sets))
    union = sorted(set.union(*date_sets))
    return common, union


def _portfolio_values(
    dates: list[str], selected: list[dict[str, Any]]
) -> list[tuple[str, float]]:
    values: list[tuple[str, float]] = []
    for date in dates:
        value = sum(
            item["holding"]["quantity"] * item["series"][date]
            for item in selected
        )
        if math.isfinite(value) and value > 0:
            values.append((date, value))
    return values


def _window_result(
    window: dict[str, str],
    loaded: list[dict[str, Any]],
) -> dict[str, Any]:
    start_date, end_date = window["startDate"], window["endDate"]
    selected: list[dict[str, Any]] = []
    notes: list[str] = []
    for item in loaded:
        series, data_type, proxy, note = _select_window_series(item, start_date, end_date)
        selected.append({"item": item, "series": series, "dataType": data_type, "proxy": proxy})
        if data_type != "observed" or note != "Observed adjusted-close history covers the requested window.":
            notes.append(f"{item['holding']['ticker']}: {note}")

    window_series = [
        {date: price for date, price in entry["series"].items() if start_date <= date <= end_date}
        for entry in selected
    ]
    common, union = _common_dates(window_series)
    aligned_missing = max(0, len(union) - len(common))
    portfolio_path = _portfolio_values(
        common,
        [
            {"holding": entry["item"]["holding"], "series": entry["series"]}
            for entry in selected
        ],
    )
    coverage_start = portfolio_path[0][0] if portfolio_path else None
    coverage_end = portfolio_path[-1][0] if portfolio_path else None
    coverage_items = []
    for entry, series in zip(selected, window_series):
        instrument_union = set(union)
        missing_count = len(instrument_union - set(series))
        if entry["dataType"] == "insufficient":
            instrument_note = entry["item"]["observedError"] or (
                "Observed history does not cover the full replay window."
            )
            if entry["item"]["holding"]["instrumentType"] == "stock":
                instrument_note += (
                    " No documented sector-index proxy is configured; no proxy was used."
                    if not entry["item"]["proxy"]
                    else " The configured proxy did not cover this window; no substitute was used."
                )
            else:
                instrument_note += " ETFs are never proxied."
        elif entry["dataType"] == "proxy" and entry["proxy"]:
            instrument_note = (
                f"Documented sector-index proxy: {entry['proxy']['label']} "
                f"({entry['proxy']['yahooSymbol']}); not an observed stock price series."
            )
        else:
            instrument_note = "Observed adjusted-close history in the requested replay window."
        coverage_items.append(
            _coverage_item(
                entry["item"],
                series,
                entry["dataType"],
                entry["proxy"],
                missing_count,
                instrument_note,
            )
        )

    result: dict[str, Any] = {
        "id": window["id"],
        "name": window["name"],
        "startDate": start_date,
        "endDate": end_date,
        "status": "unavailable",
        "coverageStart": coverage_start,
        "coverageEnd": coverage_end,
        "observationCount": len(portfolio_path),
        "maxDrawdownPct": None,
        "peakValue": None,
        "troughValue": None,
        "troughDate": None,
        "recoveryStatus": "unavailable",
        "recoveryTradingDays": None,
        "recoveryDate": None,
        "path": [],
        "instruments": coverage_items,
        "notes": [],
    }
    if not portfolio_path:
        notes.append("No dates with usable history for every holding overlap this replay window.")
        result["notes"] = notes
        return result

    first_value = portfolio_path[0][1]
    result["path"] = [
        {
            "date": date,
            "portfolioValue": round(value, 6),
            "normalizedValueIndex": round(value / first_value * 100.0, 6),
        }
        for date, value in portfolio_path
    ]
    boundaries_complete = all(
        _boundary_complete(entry["series"], start_date, end_date)
        for entry in selected
    )
    window_calendar_gap = any(
        (pd.Timestamp(right[0]) - pd.Timestamp(left[0])).days > CALENDAR_GAP_DAYS
        for left, right in zip(portfolio_path, portfolio_path[1:])
    )
    all_observed = all(entry["dataType"] == "observed" for entry in selected)
    complete = (
        boundaries_complete
        and all_observed
        and aligned_missing == 0
        and not window_calendar_gap
        and len(portfolio_path) >= 2
    )
    result["status"] = "complete" if complete else "incomplete"
    if aligned_missing:
        notes.append(
            f"{aligned_missing} date(s) in the combined source calendar lack one or more holding prices; no values were filled."
        )
    if window_calendar_gap:
        notes.append("A multi-day gap appears in the aligned replay dates; exchange holidays are not independently checked.")
    if not boundaries_complete:
        notes.append("One or more instruments do not cover both requested window boundaries.")
    if not all_observed:
        notes.append("At least one instrument has insufficient or proxy history.")
    if len(portfolio_path) < 2:
        result["status"] = "unavailable"
        notes.append("At least two aligned portfolio observations are required for replay.")
        result["notes"] = notes
        return result

    running_peak = portfolio_path[0][1]
    peak_for_trough = running_peak
    max_drawdown = 0.0
    trough_date = portfolio_path[0][0]
    trough_value = running_peak
    for date, value in portfolio_path:
        if value > running_peak:
            running_peak = value
        drawdown = value / running_peak - 1.0
        if drawdown < max_drawdown:
            max_drawdown = drawdown
            trough_date = date
            trough_value = value
            peak_for_trough = running_peak

    result["maxDrawdownPct"] = round(max_drawdown * 100.0, 4)
    result["peakValue"] = round(peak_for_trough, 6)
    result["troughValue"] = round(trough_value, 6)
    result["troughDate"] = trough_date

    if result["status"] != "complete":
        result["recoveryStatus"] = "incomplete"
        notes.append("Recovery timing is incomplete because the replay has incomplete coverage.")
    elif max_drawdown >= 0:
        result["recoveryStatus"] = "unavailable"
        notes.append("No drawdown occurred in this window, so recovery time is not applicable.")
    else:
        all_series = [entry["series"] for entry in selected]
        recovery_series = [
            {date: price for date, price in series.items() if date >= trough_date}
            for series in all_series
        ]
        recovery_common, recovery_union = _common_dates(recovery_series)
        recovery_values = _portfolio_values(
            recovery_common,
            [{"holding": entry["item"]["holding"], "series": entry["series"]} for entry in selected],
        )
        if not recovery_values or recovery_values[0][0] != trough_date:
            result["recoveryStatus"] = "incomplete"
            notes.append("Recovery timing is incomplete because source dates do not align across the full recovery period.")
        else:
            recovery = next(
                (
                    (index, date)
                    for index, (date, value) in enumerate(recovery_values)
                    if index > 0 and value >= peak_for_trough
                ),
                None,
            )
            checked_values = recovery_values[: recovery[0] + 1] if recovery else recovery_values
            checked_dates = [date for date, _ in checked_values]
            checked_start = checked_dates[0]
            checked_end = checked_dates[-1]
            aligned_union = sorted(
                {
                    date
                    for series in recovery_series
                    for date in series
                    if checked_start <= date <= checked_end
                }
            )
            aligned_common = [
                date
                for date in recovery_common
                if checked_start <= date <= checked_end
            ]
            has_recovery_gaps = (
                len(aligned_union) != len(aligned_common)
                or any(
                    (pd.Timestamp(right) - pd.Timestamp(left)).days > CALENDAR_GAP_DAYS
                    for left, right in zip(checked_dates, checked_dates[1:])
                )
            )
            if has_recovery_gaps:
                result["recoveryStatus"] = "incomplete"
                notes.append("Recovery timing is incomplete because source dates do not align before recovery or the available-history endpoint.")
            elif recovery:
                index, date = recovery
                result["recoveryStatus"] = "recovered"
                result["recoveryTradingDays"] = index
                result["recoveryDate"] = date
            else:
                result["recoveryStatus"] = "not_recovered"
                notes.append("Not recovered in available history.")

    if not notes:
        notes.append("Replay uses source-provided adjusted closes and does not impute missing prices.")
    result["notes"] = notes
    return result


def _risk_contribution(
    loaded: list[dict[str, Any]],
) -> dict[str, Any]:
    selected: list[dict[str, Any]] = []
    for item in loaded:
        series = item["observedSeries"]
        data_type = (
            "observed"
            if len(series) >= MIN_RISK_RETURN_OBSERVATIONS + 1
            else "insufficient"
        )
        proxy = None
        note = item["observedError"] or "Observed adjusted-close history."
        if len(series) < MIN_RISK_RETURN_OBSERVATIONS + 1 and item["proxy"] and item["proxySeries"]:
            series = item["proxySeries"]
            data_type = "proxy"
            proxy = item["proxy"]
            note = (
                f"Documented sector-index proxy {proxy['label']}; it is not an observed stock price series."
            )
        selected.append({"item": item, "series": series, "dataType": data_type, "proxy": proxy, "note": note})

    nonempty = [entry["series"] for entry in selected if entry["series"]]
    if not nonempty or len(nonempty) != len(selected):
        return _unavailable_risk(
            selected,
            "Risk contribution is unavailable because at least one holding has no usable observed or documented proxy history.",
        )

    overlap_start = max(list(series)[0] for series in nonempty)
    overlap_end = min(list(series)[-1] for series in nonempty)
    if overlap_start > overlap_end:
        return _unavailable_risk(
            selected,
            "Risk contribution is unavailable because holdings have no overlapping price-history dates.",
        )
    series_in_overlap = [
        {date: price for date, price in entry["series"].items() if overlap_start <= date <= overlap_end}
        for entry in selected
    ]
    common, union = _common_dates(series_in_overlap)
    return_dates = common[1:]
    instrument_coverage = []
    for entry, series in zip(selected, series_in_overlap):
        instrument_coverage.append(
            _coverage_item(
                entry["item"],
                entry["series"],
                entry["dataType"],
                entry["proxy"],
                max(0, len(union) - len(series)),
                entry["note"],
            )
        )
    if len(return_dates) < MIN_RISK_RETURN_OBSERVATIONS:
        return _unavailable_risk(
            selected,
            f"Risk contribution requires at least {MIN_RISK_RETURN_OBSERVATIONS} aligned daily returns; only {len(return_dates)} are available.",
            coverage_start=common[0] if common else None,
            coverage_end=common[-1] if common else None,
            observation_count=len(return_dates),
            instruments=instrument_coverage,
        )

    returns = pd.DataFrame(
        [
            [
                series[date] / series[previous_date] - 1.0
                for previous_date, date in zip(common, common[1:])
            ]
            for series in series_in_overlap
        ],
        index=[entry["item"]["holding"]["ticker"] for entry in selected],
    ).T
    covariance = returns.cov().to_numpy().tolist()
    latest_values = [
        entry["item"]["holding"]["quantity"] * entry["series"][common[-1]]
        for entry in selected
    ]
    total_value = sum(latest_values)
    weights = [value / total_value for value in latest_values]
    daily_variance = sum(
        weights[row] * covariance[row][column] * weights[column]
        for row in range(len(weights))
        for column in range(len(weights))
    )
    if not math.isfinite(daily_variance) or daily_variance <= 0:
        return _unavailable_risk(
            selected,
            "Risk contribution is unavailable because the aligned portfolio return series has no positive finite variance.",
            coverage_start=common[0],
            coverage_end=common[-1],
            observation_count=len(return_dates),
            instruments=instrument_coverage,
        )

    daily_volatility = math.sqrt(daily_variance)
    annualized_volatility = daily_volatility * math.sqrt(ANNUAL_TRADING_DAYS)
    annualized_components = [
        weights[row]
        * sum(covariance[row][column] * weights[column] for column in range(len(weights)))
        / daily_volatility
        * math.sqrt(ANNUAL_TRADING_DAYS)
        * 100.0
        for row in range(len(weights))
    ]
    contribution_pct = [
        component / (annualized_volatility * 100.0) * 100.0
        for component in annualized_components
    ]
    union_gap = len(union) != len(common)
    common_calendar_gap = any(
        (pd.Timestamp(right) - pd.Timestamp(left)).days > CALENDAR_GAP_DAYS
        for left, right in zip(common, common[1:])
    )
    status = "incomplete" if union_gap or common_calendar_gap or any(entry["dataType"] != "observed" for entry in selected) else "complete"
    notes: list[str] = []
    if union_gap:
        notes.append("Source dates do not align across all holdings; calculations use only exact common dates, without filling.")
    if common_calendar_gap:
        notes.append("A multi-day gap appears in common dates; exchange holidays are not independently checked.")
    if any(
        list(entry["series"])[0] < overlap_start
        or list(entry["series"])[-1] > overlap_end
        for entry in selected
    ):
        notes.append("History outside the shared portfolio overlap was excluded.")
    if any(entry["dataType"] == "proxy" for entry in selected):
        notes.append("At least one stock uses a documented sector-index proxy, labeled per instrument; ETFs are not proxied.")
    if not notes:
        notes.append("Volatility uses exact common daily adjusted-close returns; no missing observations were filled.")

    contributions = [
        {
            "ticker": entry["item"]["holding"]["ticker"],
            "instrumentType": entry["item"]["holding"]["instrumentType"],
            "latestWeightPct": round(weights[index] * 100.0, 4),
            "annualizedContributionPct": round(annualized_components[index], 4),
            "contributionPct": round(contribution_pct[index], 4),
        }
        for index, entry in enumerate(selected)
    ]
    return {
        "status": status,
        "coverageStart": common[0],
        "coverageEnd": common[-1],
        "observationCount": len(return_dates),
        "annualizedVolatilityPct": round(annualized_volatility * 100.0, 4),
        "contributions": contributions,
        "explanation": (
            "Each component estimates how much a holding added to or offset the portfolio's "
            "historical annualized volatility. Components sum to total volatility. The engine uses "
            "latest portfolio weights and the sample covariance of daily adjusted-close returns "
            "(weight × covariance with the portfolio ÷ portfolio volatility). Negative components "
            "offset volatility in this sample; they are not recommendations."
        ),
        "instruments": instrument_coverage,
        "notes": notes,
    }


def _unavailable_risk(
    selected: list[dict[str, Any]],
    reason: str,
    coverage_start: str | None = None,
    coverage_end: str | None = None,
    observation_count: int = 0,
    instruments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if instruments is None:
        instruments = [
            _coverage_item(
                entry["item"],
                entry["series"],
                entry["dataType"],
                entry["proxy"],
                0,
                entry["note"],
            )
            for entry in selected
        ]
    return {
        "status": "unavailable",
        "coverageStart": coverage_start,
        "coverageEnd": coverage_end,
        "observationCount": observation_count,
        "annualizedVolatilityPct": None,
        "contributions": [],
        "explanation": (
            "Risk contribution is the signed component of historical annualized portfolio volatility "
            "attributed to each holding using covariance."
        ),
        "instruments": instruments,
        "notes": [reason],
    }


def analyze_portfolio_risk(
    holdings: Any,
    history_fetcher: Callable[[str], pd.DataFrame] | None = None,
    proxy_mapping: dict[tuple[str, str], dict[str, str]] | None = None,
) -> dict[str, Any]:
    validation = validate_holdings(holdings)
    if not validation["valid"]:
        from engine import PortfolioInputError

        raise PortfolioInputError("Portfolio input is invalid.", validation["issues"])

    fetcher = history_fetcher or fetch_history
    proxies = DOCUMENTED_SECTOR_PROXIES if proxy_mapping is None else proxy_mapping
    loaded = _fetch_input_series(validation["holdings"], fetcher, proxies)
    windows = [_window_result(window, loaded) for window in REPLAY_WINDOWS]
    return {
        "source": SOURCE,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "replayWindows": windows,
        "riskContribution": _risk_contribution(loaded),
        "methodNotes": [
            SOURCE_NOTE,
            "All reported financial values are calculated in Python from Yahoo source-provided adjusted closes.",
            "Replay values are rupee-valued adjusted-close series for the submitted quantities; they are not brokerage account statements or realized returns.",
            "The portfolio is treated as buy-and-hold with submitted quantities. Rebalancing, taxes, fees, and external cash flows are not modeled.",
            "Replay windows are fixed periods: 2007-10-30 to 2009-03-09 and 2020-01-20 to 2020-03-23. They are only calculated when requested holdings have adequate aligned history.",
            "Risk contribution uses latest common-date value weights, sample covariance of exact common daily returns, and 252 trading days for annualization; at least 60 aligned daily returns are required.",
            "Recovery is counted in observed common trading-date steps after the within-window maximum-drawdown trough until adjusted-close portfolio value regains the prior peak.",
            "No documented stock-to-sector proxy mapping exists in this build. Missing stock history is incomplete or unavailable; ETFs are never proxied.",
            "Calendar dates are source dates, not an independently verified exchange calendar. No source prices are forward-filled or synthesized.",
        ],
    }
