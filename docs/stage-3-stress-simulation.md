# Stage 3 — static stress, reverse stress, and Monte Carlo

## Ownership and scope

Python owns all scenario validation, valuations, shocks, reverse-stress solving, resampling, path values, percentiles, and probabilities. TypeScript validates the API contract and presents the returned values. Canvas coordinate mapping is presentation, not a second financial engine. Portfolios remain session-only. There is no scoring, LLM, paid source, trading, or recommendation logic.

## Static JSON scenarios

`artifacts/api-server/python/data/scenarios.json` is the only scenario library. It defines three **hypothetical**, instrument-type shocks; none is labeled as an observed crash or calibrated forecast. User edits can change only stock and ETF shock magnitudes on a known JSON scenario. ETF underlying exposure is not inferred.

Python `validate()` rejects unknown scenario IDs, unexpected override fields, non-numeric and non-finite inputs. Finite shocks are clamped to JSON bounds (currently −95% to +50%); the response and UI disclose the values actually applied and every clamp. The checked-in library itself is validated; malformed definitions fail rather than being repaired or replaced.

Valuation is submitted quantity × source-provided **observed adjusted close** at the latest date shared by the submitted holdings. It is not an executable market quote. Scenario impact is value × shock, summed across holdings. A proxy index level never values a stock. No common observed valuation means scenario/reverse results are unavailable.

## Reverse stress

The editable target loss defaults to 20% and must be finite, greater than zero, and below 100%. Python finds the smallest common multiplier of the selected scenario's non-positive shock pattern that reaches that portfolio loss, flooring each holding at the JSON decline bound. Zero-shock holdings remain unchanged.

This is a constrained hypothetical pattern search, **not** a search for the most probable future event. Positive shock edits, all-zero patterns, unreachable targets, and unsupported numeric scales return unavailable with a reason. It does not recommend portfolio changes.

## Monte Carlo

Defaults are checked-in JSON configuration, not hidden browser constants:

- 252 trading-date steps;
- 1,000 paths, all drawn in the UI, with 253 values including the start;
- 20-step, non-circular moving blocks, sampled with replacement;
- fixed seed **20261111**, NumPy PCG64 (NumPy pinned in the lockfile);
- at least 252 valid joint source-return vectors and one eligible full block.

Each source row is the vector of all holdings' simple adjusted-close returns across the same adjacent source dates. A missing holding price excludes both adjoining intervals. A calendar interval over five days is conservatively excluded; it may be a holiday gap, because a complete independent exchange calendar has not been verified. Excluded intervals break runs, and no sampled block may bridge a run boundary. No source prices are filled.

One shared sampled row-index matrix is applied to every asset, retaining cross-asset co-movement. Within each block, source order is contiguous; the final block is truncated at the horizon. Each asset compounds separately from its observed starting value; holdings are buy-and-hold, not rebalanced every day. Taxes, fees, external cash flows and new return models are omitted.

Only source data on or before the portfolio valuation date can train the simulation. History is limited to the common overlap and may be shorter than one holding's maximum available history. Output includes retained-return counts, eligible-block counts, excluded intervals, per-instrument dates/source/proxy labels, and status. If some intervals were excluded or proxies were used, results are marked incomplete. If requirements fail, no paths or probabilities are invented.

Observed history, documented proxy returns, hypothetical JSON shocks, and **simulated paths** are labeled separately. No proxy mapping is configured in this build; test-only proxy fixtures do not create a production mapping. ETFs are never proxied. If an approved stock proxy is later configured, it is used for returns only, with actual observed stock prices still required for valuation.

Terminal percentiles are empirical 5th/50th/95th percentiles across the simulated terminal values; the displayed loss share is the fraction ending below starting value. Neither is a prediction or a guaranteed probability of future loss.

Identical holdings, source rows, JSON configuration, NumPy version, and seed reproduce identical financial outputs. A new Yahoo response can change results; timestamps are operational metadata, not deterministic financial outputs. Live source data is not frozen or persisted.

## API and checks

- `GET /api/scenarios`: Python-validated static definitions and defaults.
- `POST /api/portfolio/stress-analysis`: scenario impact, reverse stress and Monte Carlo in one transient request.
- Focused artificial fixtures test validation/clamping, invalid requests before network access, repeatability, shared joint indices, contiguous blocks, missing-date boundaries, buy-and-hold compounding, proxy/current valuation separation, ETF exclusions, source-date cutoff, and insufficient history.

The fixtures are never served as real market data. Existing Stage 1/2 tests are retained. Source limitations and earlier independent verification remain in `stage-1-verification.md`; passing calculation tests do not independently validate Yahoo's entire adjusted history.

### Verification run — 11 November 2026

- All **42 Python tests passed** (the existing 24 retained, 18 new tests). Workspace TypeScript checks and the frontend production build passed; Vite repeated the existing non-blocking tooltip source-map warning.
- The running API returned the three static scenarios and their JSON defaults.
- A temporary **test portfolio**, one VEDL share plus one NIFTYBEES unit, was used for a real Yahoo-backed endpoint check, not a claim about a user's holdings. Observed valuation date: 2026-11-11. Shared training coverage: 2009-01-02 through 2026-11-11.
- The response contained 4,393 valid joint return vectors, 4,274 eligible blocks, and all 1,000 paths with 253 values each. Eleven suspect/missing-source intervals were excluded, so simulation status was **incomplete**, not fully verified. This is not proof of eleven missing exchange sessions.
- A stock shock input of −150% was explicitly clamped to −95%. Reverse stress reached the 20% test target within the library bounds.
- Unknown scenario IDs, a 100% target, and unexpected override fields each returned HTTP 400. No observed source price was synthesized or silently filled.
- Initial-page screenshots were checked at desktop and phone sizes. Stage 3 is behind portfolio confirmation; its interactive result panel was checked through API output, contract/type checks and source inspection, not a browser-click test.
