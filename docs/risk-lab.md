# Risk Lab

All tabs reuse the confirmed, session-only holdings from Portfolio. There is no separate CSV upload. Financial values and paths are returned by Python; the browser only formats them and renders charts.

## Controls

- **Explore Possible Paths:** Run or Refresh requests Monte Carlo independently of Reverse Stress input fields. The defaults remain 1,000 paths, 252 trading days, 20-day joint blocks and the configured fixed seed. Chart/table switching, highlighted-path selection, path CSV and JSON exports use actual returned values. Source coverage and incomplete-history notes remain visible.
- **Reverse Stress Testing:** choose a static JSON scenario, enter a target loss and optional stock/ETF shocks, then Run. Python validates and clamps shocks and reports notes. The result is a hypothetical scaled pattern, not a probability or forecast. Editing inputs invalidates that reverse result, not the independent Monte Carlo result.
- **Risk Contributors:** Run or Refresh computes signed historical volatility contributions. The table shows portfolio weights, component contribution in percentage points and contribution shares. Negative contributions are kept in the signed table, never normalized into a donut. Source, analysis time, coverage and gaps are shown.
- **Recovery Time:** Run or Refresh analyzes all four fixed historical intervals. Each row includes coverage, peak/trough values, trough date, recovery status and blockers. JSON export uses the displayed full or partial scope.

## Recovery interpretation

Recovery counts observed common trading-date steps from the within-window drawdown trough until the portfolio regains its prior peak. A missing number is never replaced with zero:

- **Recovered:** Python's trading-day count and recovery date.
- **Not recovered in available history:** the prior peak was not reached.
- **Incomplete:** source history or date alignment prevents a reliable count; inspect the notes.
- **Unavailable:** no usable portfolio path, or a recovery-specific limitation explained by the source notes.
- **No drawdown:** recovery time is not applicable.

If an old window lacks history for some holdings, a separate partial recovery analysis can be explicitly confirmed. It lists included and excluded instruments, keeps the original portfolio unchanged, labels the result and its export as partial, and does not earn full-portfolio activity credit. If no eligible subset exists, the result stays unavailable. ETFs are never proxied; missing observations are not filled.

Live Yahoo requests are prototype data and may change. Fixed seed alone does not freeze third-party source history. Unit fixtures are artificial test data, not market observations.
