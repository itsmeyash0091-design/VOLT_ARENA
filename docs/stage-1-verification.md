# Stage 1 verification — 11 November 2026

## What was delivered

Session-only manual and CSV portfolio intake, Python-backed CSV parsing and row validation, an explicit confirmation gate, and per-instrument Yahoo market-history diagnostics. No later-stage analysis or scoring was implemented.

Main files: `artifacts/voltarena/src/pages/voltarena.tsx`, its app/styles, `artifacts/api-server/python/engine.py`, `test_engine.py`, `src/lib/python-engine.ts`, `src/routes/portfolio.ts`, and the API route registration. OpenAPI, generated client/Zod contracts, Python dependency/lock files, and this documentation were updated. Existing TypeScript API/UI structure was reused.

## Live source results

Source: **Yahoo Finance via yfinance**, requested with daily `period=max`, `auto_adjust=False`, `actions=True`, `repair=False`, and `keepna=True`. Checked through the connected TypeScript API at approximately **09:17 UTC / 14:47 IST on 11 November 2026**.

All six requests returned history; no ticker was skipped. All latest returned dates were **11 November 2026**, which was still during the Indian session. Current-day data is provisional.

| Ticker | Reported usable-symbol coverage start | Returned rows | Usable Adj Close | Missing Adj Close | Potential gaps | ≥20% jump flags | Returned split actions |
|---|---|---:|---:|---:|---:|---:|---:|
| TMPV | 2025-10-24 | 259 | 259 | 0 | 0 | 0 | 0 |
| ETERNAL | 2021-07-23 | 1,311 | 1,311 | 0 | 0 | 0 | 0 |
| VEDL | 1996-01-01 | 7,752 | 7,745 | 7 | 1 | 15 | 2 |
| PAYTM | 2021-11-18 | 1,231 | 1,231 | 0 | 0 | 0 | 0 |
| NYKAA | 2021-11-10 | 1,237 | 1,237 | 0 | 0 | 0 | 1 |
| NIFTYBEES (ETF spot-check) | 2009-01-02 | 4,411 | 4,401 | 10 | 1 | 2 | 0 |

“Usable” means finite and positive, not independently audited. Rows with missing adjusted prices were not filled. A gap means consecutive returned dates more than five calendar days apart; it is not proof of a missing trading session.

### TMPV identity boundary

Yahoo returned 9,055 rows starting in 1991 under `TMPV.NS`. [NSE circular CML70875](https://nsearchives.nseindia.com/content/circulars/CML70875.pdf) confirms TATAMOTORS changed to TMPV effective 24 October 2025. To avoid treating older, pre-change business history as current TMPV history, VoltArena conservatively excludes the 8,796 earlier rows and discloses that exclusion. It still fetches the maximum source history; it does not fabricate or reconstruct a demerger-adjusted series.

### Adjustment issues still open

NIFTYBEES has source adjusted-close flags of roughly −89.93% on 19 December 2019 and +896.85% on 23 December 2019, while Yahoo returned no split actions. These are **unresolved data/adjustment concerns**, not real-loss claims or confirmed corporate-action explanations. VEDL also has 15 historical jump flags. No repair was applied, and these series should not be treated as analysis-ready without later data-quality policy.

## Independent checks: exactly what was verified

Downloaded NSE's public [security-wise daily file for 10 September 2024](https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_10092024.csv) in memory and compared it with yfinance:

| Instrument/date | Yahoo raw close, to 2 decimals | NSE close | Yahoo and NSE volume |
|---|---:|---:|---:|
| VEDL, 2024-09-10 | ₹440.00 | ₹440.00 | 13,192,375 |
| NIFTYBEES, 2024-09-10 | ₹279.20 | ₹279.20 | 1,989,349 |

Both raw closes match at the source's two-decimal quote precision; volumes match exactly. Also read the official NSE TMPV symbol-change circular above.

**Not verified:** complete daily histories; adjusted-close factors or total returns; all dividends/splits/demergers; exchange-calendar completeness; official identity/type for every manually entered symbol; the NIFTYBEES 2019 anomalies; or the finality of current-day rows. The two price/volume spot-checks do not establish that the entire Yahoo series is correct. No independent full-history audit was performed.

## Checks performed

- **16 focused offline Python tests passed:** CSV quoting/mapping/limits, malformed rows, positive finite quantities, tickers/duplicates, failed and missing data, no network on invalid input, jumps/gaps/splits, Indian exchange-local dates, TMPV legacy-history exclusion, and deterministic diagnostics.
- Workspace TypeScript typecheck passed.
- Frontend production build passed. Vite emitted a non-blocking source-map warning for the scaffold's tooltip component.
- API smoke checks: universe, CSV preview, invalid-row validation, and a six-instrument live inspection returned successful structured responses.
- A final API boundary check confirmed Python's date-only coverage strings remain date-only after TypeScript response validation.
- Initial-page visual review at desktop 1440 × 1000 and phone 402 × 874: intake and confirmation panels remained readable with no evident layout break.
- Workflow and browser startup logs showed no application errors. No automated click-through browser test was run; the confirmation flow was inspected in code and the endpoints were exercised directly.

Tests use artificial, clearly isolated fixtures. Existing assertions were retained; generic pre-2025 diagnostic fixtures use VEDL rather than TMPV because pre-change TMPV rows are now intentionally excluded.

## Remaining boundaries and risks

- No proxy is configured. Missing history remains missing/insufficient, and ETFs are never proxied.
- Insufficient means fewer than 252 usable adjusted-close rows. That threshold is a diagnostic, not assurance of analysis readiness.
- Yahoo can throttle, revise data, or fail. Each ticker receives its own success/skip result; there is no invented fallback.
- CSV/holdings are transient memory only, not written as personal portfolio records. Yahoo's library may cache public ticker/timezone metadata or provider cookies; that is not portfolio storage.
- This is a development Stage 1 result, not a release package. Later analysis, rigorous historical corporate-action handling, and release verification remain intentionally deferred.
