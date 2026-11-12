# Shared portfolio across pages

Portfolio is the only input location. Crash Analytics, Risk Lab, Simulator and Reports receive the same parent-owned session holdings, not separate uploads. Each analysis page displays the holding count, imported CSV filenames where applicable, inspection state and expandable holdings. These are in-memory source labels, not persisted files.

Use the in-app navigation to switch sections. Reloading or closing the tab starts a new session and clears holdings by design. Editing holdings clears old financial results and requires confirmation again.

Missing old history is not a missing CSV. Crash Analytics names the blocking instruments and offers a separately confirmed partial replay where eligible holdings exist. A successful explicit replay request starts playback; no holdings are silently excluded.

# Portfolio dashboard

## Valuation

Confirm and inspect holdings to obtain a Python-computed snapshot from the
same histories already fetched for inspection. It does not request a second
set of prices.

Valuation uses quantity × **observed, unadjusted Close** in rupees, on the
latest date with usable Close prices for every holding. Adjustment fields
remain for historical-return diagnostics; multiplying today's quantities by
old adjusted closes would not be a current close-price valuation.

Duplicate dates are excluded, invalid/nonpositive/nonfinite prices are
excluded, and TMPV's existing identity boundary is respected. No observed
prices are filled or replaced with proxies. If a common complete date cannot
be found, the total and weights are unavailable. Individual available values
can still be shown with their own dates, but must not be called a complete
portfolio total. Short history may support valuation while remaining
insufficient for risk analysis.

Always read the date: this is a delayed prototype close-price snapshot, not
a live quote, audited exchange price, profit/loss, or cost-basis calculation.
Yahoo's current-day data may be provisional. Stock/ETF classification is
user-supplied and is not independently security-master verified.

## Session progress versus analytical Levels

Learning modules and badges describe actions completed in this browser
session. They are not financial scores or evidence of investment skill.
They reset when the holdings change and disappear on refresh; no portfolio
or progress is saved in browser storage or a database.

Investor Level is a separate Python CVaR comparison using exactly 500
fixed-seed hidden outcomes, with configurable defaults of 95% confidence and
one trading day. The benchmark uses only current holdings, long-only, fully
invested, without leverage, with equal component-CVaR contributions. A failed
or invalid solution remains unavailable; no substitute benchmark is used.
Levels are analytical comparisons, not allocation recommendations.

## Regression checks

The original 64 tests remain unchanged. Nine additional artificial-fixture
tests cover raw-versus-adjusted prices, common dates, missing holdings, no
overlapping dates, duplicate dates, invalid prices, TMPV's boundary,
overflow/JSON safety, and reuse of inspection fetches.
