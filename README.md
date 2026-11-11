# VoltArena — Stage 1

Indian listed-stock and ETF intake, market-history inspection, historical crash replay, recovery time, and volatility risk contribution. It does **not** provide trading recommendations.

## Run

- Frontend: managed workflow `artifacts/voltarena: web`.
- API: managed workflow `artifacts/api-server: API Server`.
- Python 3.13+ with the dependencies pinned in `uv.lock` must be available to the API's `python3` executable.
- Install Node dependencies with `pnpm install --frozen-lockfile`; install Python dependencies from the checked-in lock using the workspace's package tooling.

The TypeScript API launches the Python engine over JSON stdin/stdout. Python owns input normalization and all market-data diagnostics. The browser displays those results; it does not implement financial calculations.

## Input and privacy

Enter exchange tickers manually or upload a header-based CSV. Map ticker and quantity columns; exchange defaults to NSE and type defaults to stock if not mapped. Review every row, add it to the session, then choose **Review & confirm** and **Confirm and inspect**. No history request runs before that final confirmation.

Up to 50 holdings and an 80 KB CSV are supported. Quantities must be positive and finite; duplicate ticker/exchange pairs are rejected. BSE symbols should use numeric exchange codes. Instrument type is user-selected, not security-master verified.

Holdings exist only in browser state and transient API/Python memory. Refreshing clears browser holdings. There is no portfolio database, login, broker connection, or browser storage. CSV preview and row validation send input to the server before market-history confirmation; only the final confirmed request fetches history. Standard HTTP logs do not log portfolio request bodies. Yahoo receives requested ticker symbols, not quantities.

## Source and limitations

Yahoo Finance through `yfinance` is a free **prototype** source, not an official or guaranteed feed. The engine requests daily `period=max` history with source adjustment fields and actions, without automatic repair or filling. Coverage and as-of dates are reported for each ticker. A current-day row can be provisional; “as of” is the latest returned date, not a guarantee of a finalized exchange close.

Missing values remain missing. No sector proxies are configured in Stage 1; ETFs are never proxied. Fewer than 252 usable adjusted-close observations is marked insufficient. Calendar gaps over five days are potential gaps, not proven missing trading sessions: holidays are not checked. Adjusted-close moves of at least 20% are review flags, not confirmed errors.

TMPV is a special identity boundary: Yahoo attaches older TATAMOTORS rows to its current symbol. VoltArena conservatively excludes rows before the official symbol change on 24 October 2025 rather than presenting them as current TMPV history. The report discloses the exclusion. This is not a reconstructed total-return series for the demerger.

See [Stage 1 verification](docs/stage-1-verification.md) for live-data results and independent checks.
See [Stage 2 replay and risk methods](docs/stage-2-replay-risk.md) for event windows, coverage rules, recovery definition, and risk-contribution calculations.

## Checks

```sh
python3 -m unittest discover -s artifacts/api-server/python -p 'test_*.py' -v
pnpm run typecheck
```

The tests use explicitly artificial fixtures, never presented as real market data. They cover CSV parsing, input errors, missing history, splits/jumps/gaps, exchange dates, symbol-history boundaries, and no-network behavior on invalid input. Live-provider checks are separate because network access and Yahoo's data are not deterministic.

## Deliberately not implemented

Monte Carlo, reverse stress tests, static scenarios, panic game, Crash Cards, and CVaR-par Levels remain later stages. No paid APIs, broker connections, LLM scenarios, buy/sell advice, authentication, or persistent personal-portfolio storage is included.
