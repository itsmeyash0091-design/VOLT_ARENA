"""Simulated exposure choices, not trades, advice or a replacement Levels benchmark."""
from typing import Any

import numpy as np

from cvar_par import empirical_cvar


def money(value: float) -> float:
    rounded = round(float(value), 2)
    return 0.0 if rounded == 0 else rounded


def compare_exposures(losses_inr: np.ndarray | None, value: float | None,
                      budget: float | None, confidence: float, horizon: int,
                      reason: str) -> dict[str, Any]:
    result = {
        "kind": "simulated", "status": "unavailable", "horizonTradingDays": horizon,
        "evaluatedScenarioCount": 0, "choices": [], "message": reason,
        "assumptions": [
            "Each choice is a hypothetical proportional change in market exposure BEFORE the sampled horizon, not a response at a crash trough.",
            "The same 500 sampled outcomes are used for every choice. Cash earns zero; fees, taxes, slippage, execution delays and reinvestment are not modeled.",
            "Reducing exposure changes both losses and gains. No choice is graded as better or recommended.",
            "The original holdings, original loss-limit coverage and same-holdings CVaR Levels stay unchanged. This comparison is not the par benchmark.",
            "This is a horizon-specific outcome comparison, not an event path, observed future data or a five-year projection.",
        ],
    }
    if losses_inr is None or value is None:
        return result
    losses = np.asarray(losses_inr, dtype=float)
    if losses.shape != (500,) or not np.isfinite(losses).all() or not np.isfinite(value) or value <= 0:
        return result
    choices = []
    for identity, label, exposure in [
        ("hold", "Hold position (simulated)", 1.0),
        ("trim", "Sell 25% (simulated)", .75),
        ("exit", "Sell all (simulated)", 0.0),
    ]:
        sampled = losses * exposure
        tail, _ = empirical_cvar(sampled, confidence)
        within = int(np.sum(sampled <= budget)) if budget is not None else None
        choices.append({
            "id": identity, "label": label,
            "exposurePct": exposure * 100, "cashPct": (1 - exposure) * 100,
            "marketValueInr": money(value * exposure),
            "cashValueInr": money(value * (1 - exposure)),
            "worstLossInr": money(sampled.max()),
            "bestGainInr": money(-sampled.min()),
            "tailLossInr": money(tail),
            "medianEndValueInr": money(np.median(value - sampled)),
            "withinLimitCount": within,
            "coverageScorePct": round(within / 500 * 100, 6) if within is not None else None,
        })
    return {**result, "status": "available", "evaluatedScenarioCount": 500, "choices": choices,
            "message": "Simulated changes in exposure only. Compare loss reduction with missed gains; no real holdings or orders are changed."}
