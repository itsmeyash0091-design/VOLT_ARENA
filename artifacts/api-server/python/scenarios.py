"""Static scenario definitions and explicit, deterministic input validation."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from engine import PortfolioInputError

LIBRARY_PATH = Path(__file__).parent / "data" / "scenarios.json"


def library() -> dict[str, Any]:
    data = json.loads(LIBRARY_PATH.read_text())
    bounds = data["shockBoundsPct"]
    if not -100 < bounds["min"] < 0 < bounds["max"] or not all(math.isfinite(v) for v in bounds.values()):
        raise ValueError("Invalid static scenario shock bounds.")
    config = data["simulation"]
    for key in ("horizonTradingDays", "pathCount", "blockTradingDays", "seed"):
        if type(config[key]) is not int or config[key] < (0 if key == "seed" else 1):
            raise ValueError("Invalid static simulation configuration.")
    if not data["scenarios"]:
        raise ValueError("The static scenario library must not be empty.")
    ids = set()
    for scenario in data["scenarios"]:
        if scenario["id"] in ids or any(not isinstance(scenario[key], str) or not scenario[key].strip() for key in ("id", "name", "description")):
            raise ValueError("Static scenarios need unique IDs and nonempty metadata.")
        ids.add(scenario["id"])
        for field in ("stockShockPct", "etfShockPct"):
            if type(scenario[field]) not in (int, float) or not math.isfinite(scenario[field]) or not bounds["min"] <= scenario[field] <= bounds["max"]:
                raise ValueError("Static scenario shock lies outside its declared bounds.")
    return data


def input_error(message: str, code: str) -> PortfolioInputError:
    return PortfolioInputError(message, [{"row": 0, "code": code, "message": message}])


def finite_number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise input_error(f"{name} must be a finite number.", "invalid_stress_input")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        raise input_error(f"{name} must be a finite number.", "invalid_stress_input")
    if not math.isfinite(result):
        raise input_error(f"{name} must be a finite number.", "invalid_stress_input")
    return result


def validate(scenario_id: Any, overrides: Any = None) -> dict[str, Any]:
    data = library()
    scenario = next((item for item in data["scenarios"] if item["id"] == scenario_id), None)
    if scenario is None:
        raise input_error("Choose a scenario from the static JSON library.", "unknown_scenario")
    if overrides is None:
        overrides = {}
    if not isinstance(overrides, dict) or set(overrides) - {"stockShockPct", "etfShockPct"}:
        raise input_error("Only stockShockPct and etfShockPct overrides are supported.", "invalid_scenario_fields")
    result = dict(scenario)
    adjustments = []
    for field, raw in overrides.items():
        value = finite_number(raw, field)
        clamped = max(data["shockBoundsPct"]["min"], min(data["shockBoundsPct"]["max"], value))
        if value != clamped:
            adjustments.append(f"{field} was clamped from {value:g}% to {clamped:g}%.")
        result[field] = clamped
    return {**result, "kind": "hypothetical-static-json", "adjustments": adjustments}


def target_loss(value: Any) -> float:
    result = finite_number(value, "Target loss percentage")
    if not 0 < result < 100:
        raise input_error("Target loss percentage must be greater than 0 and less than 100.", "invalid_reverse_target")
    return result


def get_library() -> dict[str, Any]:
    data = library()
    return {
        "version": data["version"],
        "kind": "hypothetical-static-json",
        "shockBoundsPct": data["shockBoundsPct"],
        "simulation": data["simulation"],
        "scenarios": [validate(item["id"]) for item in data["scenarios"]],
        "notes": [
            "These are static hypothetical shocks, not observed crashes, forecasts, or recommendations.",
            "User edits change only the two shock magnitudes. Python validates and clamps them to the JSON bounds.",
            "ETF shocks apply uniformly by user-selected instrument type; ETF underlying exposure is not inferred.",
        ],
    }
