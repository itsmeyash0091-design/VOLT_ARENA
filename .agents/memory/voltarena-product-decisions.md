---
name: VoltArena MVP decisions
description: Product scope, data provenance, calculation ownership, and safety boundaries for VoltArena.
---

VoltArena's MVP is for Indian listed stocks and ETFs. Portfolio input is CSV or manual entry and personal portfolio data is session-only. Python is the single source of truth for all financial calculations and displayed figures; the TypeScript app calls the Python engine and must not duplicate calculations.

Users upload CSV holdings once on Portfolio. Every other page and section must reuse the same session holdings, without requiring another upload.

**Why:** The user repeated that Portfolio input must be shared across all sections.

**How to apply:** Keep one session portfolio and make its source and confirmation state visible on each analysis page. Navigation must not clear it; the session-only restriction still rules out persistent storage.

Use Yahoo Finance through yfinance only as a free prototype data source. Show source, as-of date, and actual history coverage. Label sector-index proxies for stocks and insufficient history; never present missing or modeled prices as observed. Keep calculations deterministic. No paid APIs, broker connections, trading, authentication, persistent personal-portfolio storage, LLM scenarios, or buy/sell advice belong in the MVP.

**Why:** The user explicitly approved these project-specific constraints for the VoltArena MVP.

**How to apply:** Preserve these boundaries in future implementation, testing, and release decisions; ask before expanding the product beyond this MVP.

## Symbol lineage and source coverage

Maximum source history is not automatically comparable current-instrument history. Preserve and disclose any conservative identity boundary instead of silently treating predecessor prices as current-security observations.

**Why:** Yahoo's TMPV series includes older TATAMOTORS history; NSE confirms the symbol change on 24 October 2025. The current business followed a demerger, so using the old series unchanged could misrepresent crash replay.

**How to apply:** Keep pre-change TMPV history excluded unless a future, explicitly labeled and independently checked reconstruction is approved. A few raw-price spot-checks never validate full adjusted-return history.

## Simulation and reverse-stress interpretation

The user requires fixed-seed joint block bootstrap of real return vectors, preserving cross-asset co-movement: 252 trading-day horizon, 1,000 visible paths, and 20-day blocks. Do not substitute independent asset sampling, Gaussian returns, or LLM-generated scenarios.

**Why:** These are explicit Stage 3 MVP constraints, not interchangeable implementation defaults.

**How to apply:** Preserve joint row alignment and within-block order in future optimizations. Inadequate source coverage must remain disclosed rather than replaced with invented prices. Reverse stress in this MVP scales a static hypothetical pattern; later Crash Cards and game copy must not describe its output as a probability or the most likely future event.

## CVaR par and panic-game interpretation

The user requires the equal component-CVaR benchmark over current holdings only, long-only and fully invested, with no replacement benchmark when unavailable. Defaults are configurable 95% confidence and one trading day. The panic limit coverage percentage is separate from Levels and must not be presented as a skill grade or a recommendation to accept more loss.

**Why:** The user explicitly chose equal component-CVaR, not minimum risk, equal weights or volatility parity. A declared loss limit can be increased arbitrarily and is not a portfolio-quality measure.

**How to apply:** Preserve the distinction in future game/card copy. Solver status alone is not proof: nonsmooth/tied empirical CVaR can produce a limited-precision status even for a candidate passing independent tail-dual and equal-component checks. Never bypass or loosen those checks to force Levels to appear.

## Simulated exposure-choice interpretation

Hold/sell choices in the Simulator compare exposure set before the sampled horizon, not trades made after observing a trough. Compare all choices on the same hidden outcomes, including missed gains. Keep original holdings, panic coverage, Levels and Crash Card separate and unchanged.

**Why:** Making the previously disabled controls functional must not imply executable timing, hindsight trading success or an alternative cash-based par benchmark. No five-year model was approved.

**How to apply:** Preserve explicit simulated labels and timing, zero cash return and excluded fees/taxes/slippage/reinvestment. Do not invent an event path or long-term forecast from horizon-end samples.

## Live-source repeatability

The same symbols, holdings, seed and coverage dates do not prove identical market-data inputs. Fresh Yahoo-backed requests produced different sampled-input digests and tiny high-precision risk differences while frozen-source runs matched across separate Python processes.

**Why:** Deterministic calculations cannot guarantee a third-party live feed will return byte-identical adjusted history.

**How to apply:** Compare input digests before attributing changes to random sampling. Disclose live-source variation; do not round or fill observed prices merely to force agreement. A future public-data snapshot policy needs explicit documentation, not a false claim of live-feed repeatability.

## Portfolio snapshot versus adjusted return history

Use observed unadjusted Close for quantity-based dashboard valuation at a common available date. Keep adjusted-return history for risk analysis separate. A complete total must not mix dates or silently omit unpriced holdings.

**Why:** Adjusted Close includes historical corporate-action/return adjustments and is not interchangeable with the actual price at which today's held units are valued. Summing only priced holdings would misrepresent missing data as a full portfolio.

**How to apply:** Display the snapshot date and source limitations. Short history can support a snapshot even when it is insufficient for simulations. Learning badges are session activity indicators, not investment skill or substitutes for Python CVaR Levels.

## Partial historical replay

A replay of only history-eligible holdings is a separate, explicitly confirmed analytical scope, never a replacement for the user's full portfolio. Keep exclusions visible and do not award full-portfolio activity credit for a subset-only result.

**Why:** Older crash windows can lack history for current instruments; silently omitting those instruments would misrepresent the full portfolio.

**How to apply:** Preserve the original session holdings and full result, disclose included and excluded instruments, and label every subset chart and export as partial.
