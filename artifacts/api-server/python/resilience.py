"""Session-only Levels, a non-trading panic rehearsal, and a fixed-template Crash Card."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from crash_card import build_crash_card, rupees
from cvar_par import empirical_cvar, solve_equal_cvar_par
from engine import SOURCE, SOURCE_NOTE, PortfolioInputError, validate_holdings
from scenarios import finite_number, input_error, library
from stress_analysis import MIN_SIMULATION_RETURNS, block_indices, prepare_history

SETTINGS_PATH = Path(__file__).parent / "data" / "game-settings.json"


def game_settings() -> dict[str, Any]:
    settings = json.loads(SETTINGS_PATH.read_text())
    if settings["hiddenScenarioCount"] != 500 or type(settings["hiddenSeed"]) is not int or settings["hiddenSeed"] < 0:
        raise ValueError("Scoring requires exactly 500 fixed-seed scenarios.")
    if not 0 < settings["componentShareTolerance"] <= 1e-4:
        raise ValueError("Component-share certification tolerance cannot exceed 0.0001.")
    return {**settings, "benchmarkMethod": "Equal component-CVaR contribution",
            "assumptions": [
                "The benchmark contains only the submitted holdings, with nonnegative weights summing to 100%; no leverage.",
                "All holdings must have equal positive shares of the benchmark's CVaR. Solver and tail-risk checks must pass; no other benchmark is substituted.",
                "CVaR is the empirical average of the worst tail, with fractional boundary probability and tied outcomes handled explicitly.",
                "Levels compare the submitted portfolio with this mathematical benchmark. They are not allocation recommendations or a measure of personal skill.",
                "The Levels score is min(100, 100 × par CVaR / current CVaR). Level thresholds are 1, 1.25, and 1.75 times par.",
                "The panic limit coverage percentage is separate from Levels. A higher declared limit mechanically increases coverage; it is not a better portfolio or a recommendation to tolerate more loss.",
                "Hidden outcomes are 500 joint-block bootstrap simulations from source returns, not observed future prices or independently observed crashes. The full outcome vectors are not sent to the browser.",
            ]}


def validated_options(options: dict[str, Any]) -> tuple[dict[str, Any], float | None, str | None]:
    defaults = game_settings()
    confidence = finite_number(options.get("confidencePct", defaults["confidencePct"]), "CVaR confidence")
    horizon = finite_number(options.get("horizonTradingDays", defaults["horizonTradingDays"]), "CVaR horizon")
    bounds = defaults["confidenceBoundsPct"]
    if not bounds["min"] <= confidence <= bounds["max"]:
        raise input_error(f"CVaR confidence must be between {bounds['min']}% and {bounds['max']}%.", "invalid_cvar_confidence")
    bounds = defaults["horizonBoundsDays"]
    if not horizon.is_integer() or not bounds["min"] <= horizon <= bounds["max"]:
        raise input_error(f"CVaR horizon must be a whole number from {bounds['min']} to {bounds['max']} trading days.", "invalid_cvar_horizon")
    budget = options.get("lossLimitInr")
    if budget is not None:
        budget = finite_number(budget, "Hypothetical rupee loss limit")
        if budget < 0:
            raise input_error("Hypothetical loss limit must be zero or greater.", "invalid_loss_limit")
    reflection = options.get("reflection")
    if reflection is not None and (reflection not in [item["id"] for item in defaults["reflections"]] or budget is None):
        raise input_error("Choose a listed reflection after entering a hypothetical loss limit.", "invalid_reflection")
    return {**defaults, "confidencePct": confidence, "horizonTradingDays": int(horizon)}, budget, reflection


def hidden_returns(rows: np.ndarray, starts: list[int], settings: dict[str, Any]) -> np.ndarray:
    config = {**library()["simulation"], "pathCount": 500, "horizonTradingDays": settings["horizonTradingDays"],
              "seed": settings["hiddenSeed"]}
    indices = block_indices(len(rows), starts, config)
    outcomes = np.prod(1 + rows[indices], axis=1) - 1
    if outcomes.shape != (500, rows.shape[1]) or not np.isfinite(outcomes).all():
        raise ValueError("Exactly 500 finite joint scenarios are required.")
    return outcomes


def unavailable_levels(reason: str) -> dict[str, Any]:
    return {"status": "unavailable", "reason": reason, "level": None, "label": "Levels unavailable",
            "scorePct": None, "currentCvarPct": None, "currentCvarInr": None,
            "parCvarPct": None, "parCvarInr": None, "ratioToPar": None,
            "maxComponentShareErrorPct": None, "holdings": []}


def grade_levels(current_cvar: float, benchmark: dict[str, Any], value: float,
                 holdings: list[dict[str, Any]], weights: np.ndarray,
                 settings: dict[str, Any]) -> dict[str, Any]:
    result = unavailable_levels(benchmark["reason"])
    result.update({"currentCvarPct": round(current_cvar * 100, 8),
                   "currentCvarInr": round(current_cvar * value, 2)})
    if benchmark["status"] != "available" or current_cvar <= 1e-12:
        if current_cvar <= 1e-12:
            result["reason"] = "Positive current and par CVaR are required for this ratio; no replacement benchmark or risk floor was used."
        return result
    par = benchmark["cvar"]
    ratio = current_cvar / par
    grade = next(item for item in settings["levels"] if item["maxRatio"] is None or ratio <= item["maxRatio"])
    return {**result, "status": "available", "reason": benchmark["reason"],
            "level": grade["level"], "label": grade["label"], "scorePct": round(min(100, 100 / ratio), 6),
            "parCvarPct": round(par * 100, 8), "parCvarInr": round(par * value, 2),
            "ratioToPar": round(ratio, 8),
            "maxComponentShareErrorPct": round(benchmark["maxShareError"] * 100, 8),
            "holdings": [
                {"ticker": holding["ticker"], "exchange": holding["exchange"],
                 "currentWeightPct": round(float(weights[index]) * 100, 8),
                 "parWeightPct": round(benchmark["weights"][index] * 100, 8),
                 "parComponentCvarInr": round(benchmark["components"][index] * value, 2),
                 "parComponentSharePct": round(benchmark["componentShares"][index] * 100, 8)}
                for index, holding in enumerate(holdings)
            ]}


def analyze_resilience(holdings: Any, options: dict[str, Any] | None = None,
                       history_fetcher: Callable[[str], pd.DataFrame] | None = None,
                       proxy_mapping: dict | None = None) -> dict[str, Any]:
    normalized = validate_holdings(holdings)
    if not normalized["valid"]:
        raise PortfolioInputError("Portfolio input is invalid.", normalized["issues"])
    settings, budget, reflection = validated_options(options or {})  # No fetch on input errors.
    prepared = prepare_history(normalized["holdings"], history_fetcher, proxy_mapping)
    value = prepared["total"]
    source_status = "incomplete" if prepared["excluded"] or prepared["historyKind"] != "observed" else "complete"
    reason = "At least 252 valid joint daily returns, a full contiguous 20-day block, and observed valuation are required."
    levels = unavailable_levels(reason)
    game = {"status": "unavailable", "lossLimitInr": budget, "evaluatedScenarioCount": 0,
            "withinLimitCount": None, "coverageScorePct": None, "revealedOutcome": None,
            "reflection": reflection, "reflectionFeedback": None,
            "message": reason}
    count, digest, cvar_inr, par_inr, worst_inr = 0, None, None, None, None
    if value is not None and len(prepared["rows"]) >= MIN_SIMULATION_RETURNS and prepared["starts"] and prepared["historyKind"] != "insufficient":
        try:
            outcomes = hidden_returns(prepared["rows"], prepared["starts"], settings)
        except (ValueError, FloatingPointError):
            outcomes = None
            levels["reason"] = game["message"] = "Exactly 500 finite hidden outcomes could not be generated; no scores were invented."
        if outcomes is not None:
            weights = np.asarray(prepared["values"]) / value
            losses = -(outcomes @ weights)
            if np.isfinite(losses).all() and np.isfinite(losses * value).all():
                count = 500
                digest = hashlib.sha256(np.asarray(outcomes, dtype="<f8").tobytes()).hexdigest()
                confidence = settings["confidencePct"] / 100
                current_cvar, _ = empirical_cvar(losses, confidence)
                benchmark = solve_equal_cvar_par(outcomes, confidence, settings["componentShareTolerance"])
                levels = grade_levels(current_cvar, benchmark, value, normalized["holdings"], weights, settings)
                cvar_inr = current_cvar * value
                par_inr = benchmark["cvar"] * value if benchmark["status"] == "available" else None
                worst_inr = float(losses.max()) * value
                game.update({"status": "ready", "evaluatedScenarioCount": 500,
                             "message": "Enter a hypothetical rupee loss limit to reveal the adverse sampled outcome and compare the limit with all 500 outcomes. No holding changes are involved."})
                if budget is not None:
                    within = int(np.sum(losses * value <= budget))
                    feedback = next((item["feedback"] for item in settings["reflections"] if item["id"] == reflection), None)
                    game.update({"status": "revealed", "withinLimitCount": within,
                                 "coverageScorePct": round(within / 500 * 100, 6),
                                 "revealedOutcome": f"{rupees(abs(worst_inr))} hypothetical {'loss' if worst_inr >= 0 else 'gain'} in the adverse sampled outcome. This is simulated, not a forecast.",
                                 "reflectionFeedback": feedback,
                                 "message": "Coverage is the share of the 500 simulated losses within your declared limit. It is not a skill grade; a higher limit mechanically raises coverage. Levels are independent of this limit."})
    if count == 0:
        source_status = "unavailable"
    card_coverage = f"{source_status} {prepared['historyKind']}"
    card = build_crash_card(value, prepared["valuationDate"], cvar_inr, par_inr, worst_inr,
                            settings["confidencePct"], settings["horizonTradingDays"], card_coverage)
    return {
        "source": SOURCE, "checkedAt": datetime.now(timezone.utc).isoformat(),
        "valuationDate": prepared["valuationDate"], "portfolioValueInr": round(value, 2) if value is not None else None,
        "settings": settings, "evaluatedScenarioCount": count, "hiddenScenarioDigest": digest,
        "historyKind": prepared["historyKind"], "coverageStatus": source_status,
        "coverageStart": prepared["common"][0] if prepared["common"] else None,
        "coverageEnd": prepared["common"][-1] if prepared["common"] else None,
        "validReturnCount": len(prepared["rows"]), "excludedIntervalCount": prepared["excluded"],
        "instruments": prepared["instruments"], "levels": levels, "panicGame": game, "crashCard": card,
        "notes": [SOURCE_NOTE,
                  "Figures are Python-generated from the same 500 fixed-seed simulated outcomes. Changing source data, confidence, or horizon can change the comparison. Operational timestamps are not financial outputs.",
                  "Missing intervals and calendar gaps over five days split source runs. No prices are filled; an independent exchange calendar has not been verified.",
                  "A proxy, if configured, is labeled and used only for returns; observed prices are required for valuation. ETFs are never proxied.",
                  "Benchmark weights are a mathematical comparison only, not an allocation recommendation. Panic reflections do not change weights, scoring, or holdings.",
                  "This is the first scoring version; no previous scoring settings or sample outcomes were replaced."],
    }
