# Stage 2 — Historical replay and core portfolio risk

## Source and trust boundary

The API calls the Python engine for both operations. TypeScript sends the confirmed session holdings and displays the response; it does not calculate financial values. The source remains Yahoo Finance via `yfinance`, using the adjusted-close series and the same TMPV identity boundary from Stage 1. The source is a free prototype feed, not a verified account or exchange statement.

No instrument-to-sector-index mapping was documented in Stage 1. The production mapping is therefore empty: a stock without adequate observed history is reported incomplete or unavailable, not silently proxied. The engine supports an explicitly documented proxy mapping when one is added later, and marks every such result as proxy history with its instrument and source. ETFs are never eligible for a proxy.

## Replay windows and values

The two fixed historical event windows are:

- Global financial crisis: 30 October 2007–9 March 2009.
- COVID-19 sell-off: 20 January–23 March 2020.

The returned coverage dates and observation count describe the exact common source dates within each window. A window is `complete` only when all holdings cover both window boundaries and aligned observations without detected date gaps or proxies; it is `incomplete` when only part of the requested portfolio/window is usable and `unavailable` when no aligned portfolio path exists.

For each common date the Python engine calculates a portfolio value as the submitted quantities multiplied by Yahoo's adjusted closes and summed across holdings. The UI also receives the series rebased to 100 on its first available replay observation. The adjusted-close value is a historical replay representation—not realized return, a brokerage statement, or a prediction. No missing observations are forward-filled or estimated.

Maximum drawdown is the largest observed fall from a prior peak within the requested event window. Recovery is measured after that drawdown trough through the latest available common observations. It is the number of observed common trading-date steps until the portfolio first reaches the prior peak. If the peak is not reached, the result is **“Not recovered in available history.”** If source dates leave the replay or recovery incomplete, recovery is labeled incomplete; if the window contains no drawdown, recovery is not applicable.

## Risk contribution

The engine uses daily simple returns from exact common adjusted-close dates over the longest overlapping history. It requires at least 60 aligned daily returns. Current weights are calculated from the submitted quantities and the latest common adjusted-close values. Historical sample covariance is used for Euler contributions:

`holding contribution = latest weight × covariance with portfolio ÷ portfolio volatility`

Annualized volatility and component volatility are scaled by `sqrt(252)`. Signed component percentages sum to the portfolio's volatility contribution; negative components indicate an offset in this historical sample, not a recommendation. If history is too short or no shared dates exist, the result is unavailable. If aligned dates are missing, any returned estimate is explicitly marked incomplete and uses only exact common dates.

## Verification

The automated fixtures cover deterministic reports, missing aligned dates, incomplete and unavailable windows, proxy provenance, ETF proxy exclusion, recovery and non-recovery, and invalid-input rejection before any market request. The fixtures are test-only and are never shown as observed market history. Live Yahoo data remains subject to the Stage 1 limitations documented in `stage-1-verification.md`.

On 11 November 2026, the live API was smoke-tested with a temporary one-share VEDL test request (not a user portfolio). It returned both windows: 332 aligned observations for the GFC window and 44 for COVID. Recovery was returned as 156 and 179 observed trading-date steps respectively. Risk contribution returned one holding component over 7,744 daily returns, marked **incomplete** because the source dates include potential multi-day gaps; without an independently verified exchange calendar, those gaps cannot be distinguished from holidays.
