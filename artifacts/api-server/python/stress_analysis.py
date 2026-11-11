"""Hypothetical stress and joint moving-block bootstrap, with no invented source prices."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Callable

import numpy as np
import pandas as pd

from engine import SOURCE, SOURCE_NOTE, PortfolioInputError, fetch_history, validate_holdings
from risk_analysis import (
    CALENDAR_GAP_DAYS, DOCUMENTED_SECTOR_PROXIES, _common_dates,
    _coverage_item, _fetch_input_series,
)
from scenarios import library, target_loss, validate

MIN_SIMULATION_RETURNS = 252


def joint_returns(series: list[dict[str, float]], block_days: int) -> tuple[np.ndarray, list[int], int]:
    """Each row is one *joint* source interval; block starts never cross excluded intervals."""
    if not series or any(not item for item in series):
        return np.empty((0, len(series))), [], 0
    start = max(min(item) for item in series)
    end = min(max(item) for item in series)
    union = sorted({day for item in series for day in item if start <= day <= end})
    vectors, run_ids = [], []
    excluded, run = 0, 0
    for left, right in zip(union, union[1:]):
        if any(left not in item or right not in item for item in series) or (
            pd.Timestamp(right) - pd.Timestamp(left)
        ).days > CALENDAR_GAP_DAYS:
            excluded += 1
            run += 1
            continue
        row = [item[right] / item[left] - 1 for item in series]
        if not all(math.isfinite(value) and value > -1 for value in row):
            excluded += 1
            run += 1
            continue
        vectors.append(row)
        run_ids.append(run)
    starts = [
        index for index in range(len(vectors) - block_days + 1)
        if run_ids[index] == run_ids[index + block_days - 1]
    ]
    return np.asarray(vectors, dtype=float).reshape((-1, len(series))), starts, excluded


def block_indices(row_count: int, starts: list[int], config: dict[str, int]) -> np.ndarray:
    """One shared row-index matrix for every asset, sampled with replacement, without wraparound."""
    if not starts:
        raise ValueError("No complete contiguous joint blocks.")
    rng = np.random.Generator(np.random.PCG64(config["seed"]))
    size = config["blockTradingDays"]
    blocks = math.ceil(config["horizonTradingDays"] / size)
    selected = rng.choice(starts, size=(config["pathCount"], blocks), replace=True)
    indices = (selected[:, :, None] + np.arange(size)).reshape(config["pathCount"], -1)
    indices = indices[:, :config["horizonTradingDays"]]
    if int(indices.max()) >= row_count:
        raise ValueError("Block exceeds available history.")
    return indices


def shock_result(holdings: list[dict[str, Any]], values: list[float], shocks: list[float]) -> dict[str, Any]:
    total = sum(values)
    impacts = [value * (shock / 100) for value, shock in zip(values, shocks)]
    return {
        "impactInr": round(sum(impacts), 2),
        "lossPct": round(-sum(impacts) / total * 100, 6),
        "stressedValueInr": round(total + sum(impacts), 2),
        "holdings": [
            {"ticker": holding["ticker"], "exchange": holding["exchange"],
             "shockPct": round(shock, 6), "impactInr": round(impact, 2),
             "stressedValueInr": round(value + impact, 2)}
            for holding, value, impact, shock in zip(holdings, values, impacts, shocks)
        ],
    }


def reverse_stress(holdings: list[dict[str, Any]], values: list[float], shocks: list[float], target: float) -> dict[str, Any]:
    total = sum(values)
    result = {"kind": "hypothetical-static-json", "status": "unavailable",
              "targetLossPct": target, "targetLossInr": round(total * target / 100, 2),
              "scaleMultiplier": None, "impactInr": None, "lossPct": None,
              "stressedValueInr": None, "holdings": [], "notes": []}
    if any(shock > 0 for shock in shocks) or not any(shock < 0 for shock in shocks):
        result["notes"] = ["Reverse stress requires a non-positive shock pattern with at least one decline. Choose or edit a static scenario accordingly."]
        return result
    floor = library()["shockBoundsPct"]["min"]
    def scaled(multiplier: float) -> list[float]:
        return [max(floor, shock * multiplier) for shock in shocks]
    maximum = sum(value * ((-floor if shock < 0 else 0) / 100) for value, shock in zip(values, shocks))
    target_value = total * (target / 100)
    tolerance = max(abs(target_value), abs(maximum)) * 1e-12
    if target_value > maximum + tolerance:
        result["notes"] = ["The target cannot be reached within the per-holding decline floor of the static JSON library."]
        return result
    target_value = min(target_value, maximum)  # Only roundoff at the attainable boundary.
    high = 1.0
    while -sum(value * (shock / 100) for value, shock in zip(values, scaled(high))) < target_value:
        high *= 2
        if not math.isfinite(high):
            result["notes"] = ["The required multiplier exceeds supported finite numeric limits."]
            return result
    low = 0.0
    for _ in range(80):
        mid = (low + high) / 2
        loss = -sum(value * (shock / 100) for value, shock in zip(values, scaled(mid)))
        if loss >= target_value:
            high = mid
        else:
            low = mid
    result.update(shock_result(holdings, values, scaled(high)))
    result.update({"status": "available", "scaleMultiplier": round(high, 8),
                   "notes": ["Smallest common multiplier of the selected static shock pattern to reach the target; each holding's decline is floored at the JSON bound. This is not a prediction or trade recommendation."]})
    return result


def prepare_history(
    normalized_holdings: list[dict[str, Any]],
    history_fetcher: Callable[[str], pd.DataFrame] | None = None,
    proxy_mapping: dict | None = None,
) -> dict[str, Any]:
    config = dict(library()["simulation"])
    loaded = _fetch_input_series(normalized_holdings, history_fetcher or fetch_history,
                                 DOCUMENTED_SECTOR_PROXIES if proxy_mapping is None else proxy_mapping)
    selected, instruments = [], []
    for item in loaded:
        series, proxy, kind = item["observedSeries"], None, "observed"
        note = "Observed adjusted-close history; no source prices were filled."
        if len(series) <= MIN_SIMULATION_RETURNS and item["proxy"] and len(item["proxySeries"]) > MIN_SIMULATION_RETURNS:
            series, proxy, kind = item["proxySeries"], item["proxy"], "proxy"
            note = f"Documented sector-index proxy {proxy['label']} used for returns only, not stock valuation; not observed stock history."
        elif len(series) <= MIN_SIMULATION_RETURNS:
            kind, note = "insufficient", item["observedError"] or "Fewer than 253 adjusted-close prices; no proxy was inferred. ETFs are never proxied."
        selected.append(series)
        instruments.append(_coverage_item(item, series, kind, proxy, 0, note))
    observed_common, _ = _common_dates([item["observedSeries"] for item in loaded])
    valuation_date = observed_common[-1] if observed_common else None
    values = [item["holding"]["quantity"] * item["observedSeries"][valuation_date] for item in loaded] if valuation_date else []
    if not values or not all(math.isfinite(value) and value > 0 for value in values) or not math.isfinite(sum(values)):
        values, valuation_date = [], None
    total = sum(values) if values else None
    if valuation_date:
        # Never train on source observations later than the observed valuation date.
        selected = [{day: price for day, price in series.items() if day <= valuation_date} for series in selected]
        for coverage, series in zip(instruments, selected):
            coverage.update({"coverageStart": min(series) if series else None,
                             "coverageEnd": max(series) if series else None,
                             "observationCount": len(series)})
    common, union = _common_dates(selected)
    union = [day for day in union if common and common[0] <= day <= common[-1]]
    for coverage, series in zip(instruments, selected):
        coverage["missingAlignedObservations"] = sum(day not in series for day in union)
    rows, starts, excluded = joint_returns(selected, config["blockTradingDays"])
    history_kind = "insufficient" if any(item["dataType"] == "insufficient" for item in instruments) else (
        "proxy" if all(item["dataType"] == "proxy" for item in instruments) else
        "mixed" if any(item["dataType"] == "proxy" for item in instruments) else "observed"
    )
    return {"loaded": loaded, "instruments": instruments, "valuationDate": valuation_date,
            "values": values, "total": total, "common": common, "rows": rows,
            "starts": starts, "excluded": excluded, "historyKind": history_kind}


def run_portfolio_stress(
    holdings: Any, scenario_id: Any, overrides: Any = None, target: Any = "20",
    history_fetcher: Callable[[str], pd.DataFrame] | None = None,
    proxy_mapping: dict | None = None,
) -> dict[str, Any]:
    validated = validate_holdings(holdings)
    if not validated["valid"]:
        raise PortfolioInputError("Portfolio input is invalid.", validated["issues"])
    scenario = validate(scenario_id, overrides)
    target = target_loss(target)  # Reject invalid requests before any network access.
    config = dict(library()["simulation"])
    prepared = prepare_history(validated["holdings"], history_fetcher, proxy_mapping)
    loaded, instruments = prepared["loaded"], prepared["instruments"]
    valuation_date, values, total = prepared["valuationDate"], prepared["values"], prepared["total"]
    common, rows, starts = prepared["common"], prepared["rows"], prepared["starts"]
    excluded, history_kind = prepared["excluded"], prepared["historyKind"]
    simulation = {
        "kind": "simulated", "status": "unavailable", "config": config,
        "coverageStart": common[0] if common else None, "coverageEnd": common[-1] if common else None,
        "validReturnCount": len(rows), "eligibleBlockCount": len(starts),
        "excludedIntervalCount": excluded, "historyKind": history_kind, "instruments": instruments,
        "paths": [], "terminalPercentiles": [], "lossProbabilityPct": None,
        "plotMinInr": None, "plotMaxInr": None,
        "notes": [
            "All paths are simulated, not observed future prices or forecasts.",
            "Joint moving blocks preserve cross-asset source-date co-movement and within-block ordering. Blocks are sampled with replacement, not wrapped.",
            "Simulations are buy-and-hold from observed adjusted-close valuation, with no rebalancing, taxes, fees, or cash flows.",
            "Only adjacent, fully observed joint intervals are used. Missing holding dates and calendar gaps over five days split eligible blocks. No missing prices are filled.",
            "An independent exchange calendar has not been verified. Source changes can change results; reproducibility requires identical source history, holdings, JSON configuration, and seed.",
        ],
    }
    scenario_result = {**scenario, "status": "unavailable", "impactInr": None,
                       "lossPct": None, "stressedValueInr": None, "holdings": [],
                       "notes": ["Scenario shocks are hypothetical, not observed historical returns."]}
    reverse = {"kind": "hypothetical-static-json", "status": "unavailable",
               "targetLossPct": target, "targetLossInr": None, "scaleMultiplier": None,
               "impactInr": None, "lossPct": None, "stressedValueInr": None, "holdings": [],
               "notes": ["Observed valuation is unavailable; no proxy index level is used to value stock holdings."]}
    if values:
        shocks = [scenario["stockShockPct" if item["holding"]["instrumentType"] == "stock" else "etfShockPct"] for item in loaded]
        scenario_result.update(shock_result(validated["holdings"], values, shocks))
        scenario_result["status"] = "available"
        reverse = reverse_stress(validated["holdings"], values, shocks, target)
    else:
        scenario_result["notes"].append("No common observed valuation date exists, or values exceed supported finite numeric limits.")
    if values and len(rows) >= MIN_SIMULATION_RETURNS and starts and history_kind != "insufficient":
        indices = block_indices(len(rows), starts, config)
        # Accumulate each asset separately: no daily portfolio rebalancing.
        asset_growth = np.ones((config["pathCount"], len(values)), dtype=float)
        paths = np.empty((config["pathCount"], config["horizonTradingDays"] + 1))
        paths[:, 0] = total
        for day in range(config["horizonTradingDays"]):
            asset_growth *= 1 + rows[indices[:, day]]
            paths[:, day + 1] = asset_growth @ np.asarray(values)
        if np.isfinite(paths).all():
            simulation.update({
                "status": "incomplete" if excluded or history_kind != "observed" else "complete",
                "paths": [{"id": index + 1, "valuesInr": [round(float(value), 2) for value in path]} for index, path in enumerate(paths)],
                "terminalPercentiles": [
                    {"percentile": percentile, "valueInr": round(float(np.percentile(paths[:, -1], percentile)), 2)}
                    for percentile in (5, 50, 95)
                ],
                "lossProbabilityPct": round(float(np.mean(paths[:, -1] < total) * 100), 4),
                "plotMinInr": round(float(paths.min()), 2), "plotMaxInr": round(float(paths.max()), 2),
            })
        else:
            simulation["notes"].append("Simulated values exceeded finite numeric limits; no paths are shown.")
    else:
        simulation["notes"].append("Monte Carlo requires observed current valuation, at least 252 valid joint daily returns, and a full 20-day contiguous block. No paths are invented for insufficient data.")
    return {
        "source": SOURCE, "checkedAt": datetime.now(timezone.utc).isoformat(),
        "valuationDate": valuation_date, "portfolioValueInr": round(total, 2) if total is not None else None,
        "scenario": scenario_result, "reverseStress": reverse, "monteCarlo": simulation,
        "methodNotes": [SOURCE_NOTE, "Every financial figure is calculated in Python. JSON scenarios and simulated paths are hypothetical and are not investment advice.",
                        "Current valuation uses source-provided observed adjusted closes, not executable quotes. Proxy history, if configured, is labeled by instrument and dates and used only for returns."],
    }
