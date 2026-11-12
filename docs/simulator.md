# Simulator: session-only rehearsal

The Simulator reuses the confirmed holdings from Portfolio. It never uploads another CSV, changes quantities, stores personal portfolios or sends orders. Echo's three guide pages use fixed, plain-language educational text.

## Run and reveal

1. Confirm and inspect holdings on Portfolio.
2. Enter a nonnegative rupee loss limit, optionally choose a reflection and adjust the Python-supplied confidence/horizon settings.
3. Run the rehearsal. Python samples exactly 500 fixed-seed joint-block bootstrap outcomes from eligible historical returns.
4. Review the original portfolio's loss-limit coverage, source dates, gaps and the analytical CVaR Level (or its unavailability reason).
5. Select a simulated exposure choice to inspect the separate comparison. Export JSON or comparison CSV locally if needed.

Changing the declared limit changes coverage mechanically; it is not a skill grade. Reflections do not alter holdings or financial outcomes. Levels retain their same-holdings, long-only, fully invested, equal component-CVaR benchmark; cash choices are **not** an alternative par solution.

## Simulated exposure comparison

Python evaluates all three hypothetical choices against the **same** 500 outcomes:

- Hold: retain all market exposure.
- Sell 25%: retain 75% of each holding's starting market exposure, with the remainder modeled as cash.
- Sell all: model the starting value as cash with zero return.

These are comparisons of exposure set **before the sampled horizon**, not simulated execution after seeing a crash trough. Cash earns zero. Fees, taxes, slippage, execution delays and reinvestment are excluded. Both lost gains and reduced losses matter; no choice is recommended or graded as best. The original session holdings, loss-limit result, Levels and Crash Card are unchanged by selecting a comparison.

Displayed measures are Python-generated:

- **Largest sampled signed loss:** maximum loss across the 500 outcomes; a negative value means even the adverse sample gained.
- **Best sampled signed gain:** maximum gain; a negative value means every sampled outcome lost.
- **Tail loss (CVaR):** empirical worst-tail average at the selected confidence. Negative loss represents gain.
- **Median end value:** median portfolio-plus-cash value at the selected horizon, not a forecast.
- **Within limit:** count and percentage of the same 500 hypothetical losses within the declared limit.

No event path or five-year projection is invented. The comparison is an outcome table for the returned horizon, not a time-series chart. Missing history leaves the comparison unavailable, including the all-cash choice; the source requirement is not bypassed to manufacture a playable result.

## Source and repeatability

Yahoo Finance via yfinance is a free prototype source, not an official or audited feed. Show valuation date, analyzed time, coverage and per-holding observed/proxy/insufficient labels. Never fill missing prices. The Portfolio raw-close snapshot is separate from the adjusted-history starting value used by the rehearsal.

Determinism requires identical source inputs as well as the same seed and settings; a live feed can revise history. Artificial fixtures in automated tests are not real observations.

## Verification

The added exposure-comparison tests cover scaling, all-cash outcomes, signed gains, missing budgets, exactly-500 input enforcement, unavailable history and consistency with the original game/CVaR. Existing tests remain unchanged. Original scoring settings and outputs were compared against the prior implementation on frozen fixtures and matched; this feature adds a comparison, not a scoring revision.
