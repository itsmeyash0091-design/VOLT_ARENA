# Stage 4 — Levels, panic rehearsal, and Crash Card

## Scoring version and before/after

**Before:** Stages 1–3 had no hidden scoring, Levels, panic game or Crash Card. There is no previous scoring baseline to recalibrate.

**After:** The first ruleset is `cvar-par-v1`, defined in `artifacts/api-server/python/data/game-settings.json`. No earlier scoring settings or recorded sample outcomes were changed to fit tests. The existing visible Monte Carlo settings remain unchanged. The shared history-preparation code was extracted without changing its calculations.

## Exactly 500 hidden outcomes

Python generates exactly **500** fixed-seed joint-block bootstrap outcomes, seed **20261112**. Source-return runs and 20-day eligible block starts use the same missing-date and symbol-identity protections as Stage 3. For a one-day horizon, only the first day of each sampled eligible block is used; longer horizons compound each asset separately and truncate the final block. There is no portfolio rebalancing within a simulated path.

The hidden set is separate from the 1,000 visible Monte Carlo paths. The full outcome matrix is not returned to the browser or saved. Its digest, seed and evaluated count are returned for traceability. “Hidden” means not displayed as individual vectors, not a secure anti-cheat system.

Levels, current/par CVaR, the panic coverage percentage and Crash Card all use this same set. If source requirements or finite-number checks fail, evaluated count is **0**, scores are unavailable, and no sample result is fabricated. Repeated identical holdings, source rows, settings, solver versions and seed produce identical financial figures. New live Yahoo rows can change results; timestamps are operational metadata.

## CVaR and the par solution

Defaults are **95% confidence and one trading day**. They are configurable in Python-owned settings and per request (confidence 50–99%, horizon 1–252 whole trading days).

Loss is minus the weighted simulated return. Empirical CVaR is the average loss in the worst `1 − confidence` probability mass. At the default, that is the worst 25 probability-equivalent observations out of 500. Non-integer boundary mass is retained, not rounded away; tied outcomes share probability.

The par benchmark:

- uses only the submitted holdings;
- has long-only, fully invested weights summing to one, with no leverage;
- gives every holding an equal positive component-CVaR share;
- uses the same 500 outcomes, confidence and horizon as the current portfolio;
- requires positive finite current and par CVaR for the comparison ratio.

Python solves the convex risk-budget problem

`min CVaR(losses × x) − (1/n) Σ log(x_i), x_i > 0`

using CVXPY/Clarabel, then normalizes `x` to fully invested weights. Positive homogeneity preserves equal component shares. This is not equal weighting, minimum variance, minimum CVaR, a volatility approximation, or an allocation recommendation. Identical scenario vectors may be compressed into weighted solver constraints, with their full multiplicity retained: the empirical probability distribution still contains exactly 500 draws.

### Independent numerical checks

The empirical CVaR is recalculated independently after solving. Tail dual probabilities must sum to one and stay within their empirical probability caps. The relative tail primal/dual gap must not exceed `1e-6`. The maximum absolute component-share error must not exceed `0.0001` (0.01 percentage points of total CVaR). Weights must be finite, nonnegative and fully invested.

A solver's “optimal” status is not sufficient by itself. A limited-precision candidate can only be used if the same independent certificate passes, and the reason discloses the solver warning. Failed, unbounded, zero-risk, non-finite or uncertifiable candidates yield **Levels unavailable**, with no replacement benchmark or artificial risk floor. Certification is numerical model validation, not verification of Yahoo's market history.

### Levels formula

For a valid benchmark:

- ratio = current CVaR / par CVaR;
- score = `min(100, 100 / ratio)`;
- Level 4: ratio ≤ 1;
- Level 3: ratio ≤ 1.25;
- Level 2: ratio ≤ 1.75;
- Level 1: above 1.75.

These are initial transparent comparison rules, not calibrated investment-quality grades. Benchmark weights and Levels are **analytical comparisons, not allocation recommendations**. All figures and labels are returned by Python.

## Non-trading panic game

The user enters a **hypothetical rupee loss limit**. Python reveals the adverse outcome among the hidden simulations and reports how many of the 500 simulated losses were within that declared limit:

`budget coverage = within-limit count / 500 × 100`

This coverage percentage is not a personal skill score, not a portfolio grade, and not advice about how much loss to accept. Increasing the limit mechanically increases coverage. It is independent of Levels.

The user can choose a neutral reflection: pause, review source coverage, or review assumptions. Fixed JSON supplies the choices and feedback. Reflections never change holdings, weights, scores or the Crash Card. No trading actions or broker connections exist. Without a limit, the game is ready but no coverage percentage or reveal is invented.

## Crash Card contract

Python builds a fixed template from its calculated values. The card:

- begins with rupees or an explicit unavailable rupee valuation;
- includes at most three findings;
- stays strictly below 120 words, including header and footer;
- puts rupee amounts before loss descriptions;
- labels modeled outcomes as simulated and identifies source/coverage limitations;
- contains no buy/sell advice, ticker suggestions, LLM output or user-supplied prose.

Unavailable comparisons remain unavailable in the text. A negative estimated tail loss is described as a sampled gain, not converted into a positive loss or a safety claim. The frontend renders the returned content without truncation or rewriting; its displayed word count is Python's count.

## API, privacy and verification

- `GET /api/game/settings`: fixed rules, defaults, bounds and benchmark assumptions.
- `POST /api/portfolio/resilience`: holdings and optional numeric strings for confidence, horizon and loss limit; optional listed reflection.
- Invalid options are rejected before market access. Holdings, hidden outcomes and results remain transient; no personal portfolio is persisted.
- Tests include exact/fractional CVaR, ties, known unequal-weight equal-risk solutions, deterministic scoring, seed sensitivity, scale invariance, zero-risk and solver-unavailable cases, deliberately corrupted solver candidates, proxy labels, insufficient history, panic/Levels independence, configuration guards, and Crash Card limits/content.
- Fixtures are artificial test data, never presented as real history. Yahoo remains a free prototype source; source caveats and earlier spot checks are documented in Stage 1. This stage does not independently validate the entire price history.

## Verification record — 11 November 2026

The 63-test Python suite passed, followed by an additional fresh-process frozen-source reproducibility test: **64 distinct tests passed**, including all 42 prior tests unchanged. Workspace type checks, frontend production build, and whitespace checks passed. Vite repeated the existing non-blocking tooltip source-map warning.

The live endpoint was checked with a temporary **test portfolio**, one VEDL share plus one NIFTYBEES unit, not a user's holdings. At 95% confidence and a one-day horizon, one response returned:

| Python result | Test response |
| --- | --- |
| Observed adjusted-close valuation | ₹550.42 as of 2026-11-11 |
| Hidden scenarios evaluated | 500 |
| Current CVaR loss | ₹18.83 |
| Equal-component par CVaR loss | ₹15.96 |
| Level and score | Level 3; 84.731021% |
| Hypothetical ₹25 limit coverage | 498 / 500; 99.6% |
| Crash Card | 3 findings, 61 words |

The shared source history had 4,393 valid return vectors and 11 excluded source intervals; coverage was labeled **incomplete**. Excluded intervals are not proof of missing exchange sessions, because a complete exchange calendar has not been independently checked.

Two fresh live requests did **not** reproduce every high-precision figure: sampled-input digests differed, and the score ranged from 84.731021% to 84.730979% in the recorded pair. The reported current/par rupee CVaR and Crash Card were unchanged in that pair. This is not claimed as live-feed repeatability. Frozen identical source inputs matched exactly, including across separate Python processes. No source prices were rounded, filled or frozen without disclosure to hide these differences.

Invalid confidence, fractional horizons, negative loss limits, and attempts to change the hidden count through the API returned HTTP 400. Reflection feedback was returned without changing holdings.

The initial desktop page loaded cleanly after workflow restart. Interactive Stage 4 browser clicks and the complete phone/desktop release flow have not been run; they remain part of the separate final release review. Stage 4 content and bindings were checked through live API responses, generated contracts, type checks, and source inspection.
