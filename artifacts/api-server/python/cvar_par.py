"""Empirical CVaR and a certified equal component-CVaR risk-budget solution."""
from __future__ import annotations

import warnings
from typing import Any

import cvxpy as cp
import numpy as np


def empirical_cvar(losses: np.ndarray, confidence: float) -> tuple[float, np.ndarray]:
    """Exact empirical upper-tail mean; fractional boundary mass is shared across ties."""
    losses = np.asarray(losses, dtype=float)
    if losses.ndim != 1 or not len(losses) or not np.isfinite(losses).all() or not 0 < confidence < 1:
        raise ValueError("CVaR needs finite losses and confidence strictly between zero and one.")
    mass = len(losses) * (1 - confidence)
    if abs(mass - round(mass)) < 1e-10:
        mass = float(round(mass))
    boundary = np.sort(losses)[::-1][min(int(np.ceil(mass)) - 1, len(losses) - 1)]
    q = np.zeros(len(losses))
    above, tied = losses > boundary, losses == boundary
    q[above] = 1 / mass
    q[tied] = (1 - float(q.sum())) / int(tied.sum())
    return float(q @ losses), q


def solve_equal_cvar_par(returns: np.ndarray, confidence: float, tolerance: float = 1e-4) -> dict[str, Any]:
    """Risk-budget convex program, then normalization and independent primal/dual certification.

    min CVaR(Ax) - (1/n) sum(log(x_i)), x_i > 0.
    KKT yields x_i * dCVaR/dx_i = 1/n. Positive homogeneity permits
    normalization to fully invested weights without changing component shares.
    """
    unavailable = lambda reason: {"status": "unavailable", "reason": reason, "weights": [],
                                  "cvar": None, "components": [], "componentShares": [],
                                  "maxShareError": None}
    returns = np.asarray(returns, dtype=float)
    if returns.ndim != 2 or not returns.size or not np.isfinite(returns).all() or not 0 < confidence < 1:
        return unavailable("Non-finite or empty scenario returns prevent a valid benchmark.")
    count, assets = returns.shape
    losses = -returns
    if assets == 1:
        risk, _ = empirical_cvar(losses[:, 0], confidence)
        if risk <= 1e-12:
            return unavailable("No positive tail-risk solution exists for this holding in the sampled outcomes.")
        return {"status": "available", "reason": "Certified single-holding equal component-CVaR solution.",
                "weights": [1.0], "cvar": risk, "components": [risk],
                "componentShares": [1.0], "maxShareError": 0.0}
    scale = float(np.max(np.abs(losses)))
    if scale <= 1e-12:
        return unavailable("Scenario losses contain no positive finite scale for a risk-budget solution.")
    # Exact multiplicity compression, not fewer scoring scenarios. It removes
    # duplicate solver constraints while preserving all 500 empirical probabilities.
    unique_losses, multiplicities = np.unique(losses, axis=0, return_counts=True)
    x, cutoff, excess = cp.Variable(assets, pos=True), cp.Variable(), cp.Variable(len(unique_losses), nonneg=True)
    tail = excess >= (unique_losses / scale) @ x - cutoff
    objective = cutoff + multiplicities @ excess / ((1 - confidence) * count) - cp.sum(cp.log(x)) / assets
    problem = cp.Problem(cp.Minimize(objective), [tail])
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            problem.solve(solver="CLARABEL", max_iter=300, max_threads=1,
                          tol_gap_abs=1e-10, tol_gap_rel=1e-10, tol_feas=1e-10)
    except (cp.error.SolverError, ValueError, ArithmeticError):
        return unavailable("The equal component-CVaR solver could not certify a solution; no alternative benchmark was substituted.")
    # A solver status is not a certificate. Even a limited-precision candidate
    # must pass the same independent empirical tail, dual, budget, and weight
    # checks below; an "optimal" status alone never bypasses them.
    if problem.status not in (cp.OPTIMAL, cp.OPTIMAL_INACCURATE) or x.value is None or tail.dual_value is None:
        return unavailable(f"The equal component-CVaR problem was not certified optimal ({problem.status}); no fallback benchmark was used.")
    allocation = np.asarray(x.value, dtype=float)
    q = np.asarray(tail.dual_value, dtype=float)
    if not np.isfinite(allocation).all() or np.any(allocation <= 0) or not np.isfinite(q).all():
        return unavailable("The solver returned invalid weights or tail multipliers.")
    weights = allocation / allocation.sum()
    risk, _ = empirical_cvar(losses @ weights, confidence)
    components = weights * (unique_losses.T @ q)
    if risk <= 1e-12:
        return unavailable("A positive CVaR benchmark is unavailable for these scenarios.")
    shares = components / risk
    gap = abs(float(q @ (unique_losses @ weights)) - risk) / risk
    error = float(np.max(np.abs(shares - 1 / assets)))
    dual_valid = (np.min(q) >= -1e-8 and np.all(q <= multiplicities / ((1 - confidence) * count) + 1e-7)
                  and abs(float(q.sum()) - 1) <= 1e-7)
    if not dual_valid or gap > 1e-6 or error > tolerance or np.any(weights < 0) or abs(float(weights.sum()) - 1) > 1e-10:
        return unavailable("The numerical solution failed the tail-risk or equal-contribution checks; no fallback benchmark was used.")
    reason = "Equal component-CVaR solution passed long-only, fully invested, tail-dual, and contribution checks."
    if problem.status == cp.OPTIMAL_INACCURATE:
        reason += " The solver reported limited precision; the independent numerical certificate still passed the unchanged tolerances."
    return {"status": "available", "reason": reason,
            "weights": weights.tolist(), "cvar": risk, "components": components.tolist(),
            "componentShares": shares.tolist(), "maxShareError": error}
