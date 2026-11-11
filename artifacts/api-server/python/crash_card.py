"""Fixed prose only: no LLM, user-supplied prose, recommendations, or sampled-price claims."""
from __future__ import annotations

from typing import Any


def rupees(value: float) -> str:
    return f"₹{value:,.2f}"


def build_crash_card(value: float | None, as_of: str | None, cvar_inr: float | None,
                     par_inr: float | None, worst_loss_inr: float | None,
                     confidence_pct: float, horizon: int, coverage: str) -> dict[str, Any]:
    header = (f"{rupees(value)} portfolio value as of {as_of}, using adjusted closes."
              if value is not None else "₹ value unavailable: observed prices are insufficient.")
    if cvar_inr is None:
        findings = ["Rupee tail loss unavailable: aligned history is insufficient."]
    else:
        outcome = "loss" if cvar_inr >= 0 else "gain"
        findings = [f"{rupees(abs(cvar_inr))} average {outcome} in the worst {100 - confidence_pct:g}% of 500 simulated {horizon}-day outcomes."]
    if par_inr is not None:
        findings.append(f"{rupees(par_inr)} is the equal-risk comparison's average tail loss, not an allocation recommendation.")
    else:
        findings.append("Rupee comparison unavailable: no valid equal-risk benchmark was certified.")
    if worst_loss_inr is not None:
        outcome = "loss" if worst_loss_inr >= 0 else "gain"
        findings.append(f"{rupees(abs(worst_loss_inr))} {outcome} in the worst sampled outcome; this is not a forecast.")
    footer = f"Yahoo Finance prototype data; {coverage} history. Simulated outcomes are not observed prices. No trading advice."
    text = "\n".join([header, *findings, footer])
    word_count = len(text.split())
    if len(findings) > 3 or word_count >= 120:
        raise ValueError("Crash Card template exceeded its fixed content limits.")
    return {"templateVersion": "crash-card-v1", "header": header, "findings": findings,
            "footer": footer, "text": text, "wordCount": word_count}
