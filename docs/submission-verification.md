# College submission verification

Release preparation: 12 November 2026.

## Automated checks completed

- 85 Python tests passed, including the original tests unchanged.
- 15 browser-side parser/helper tests passed. CSV preview was tested with `fetch` deliberately disabled.
- Workspace TypeScript checks passed.
- Production UI and API builds passed. Vite emits a pre-existing, nonfatal tooltip sourcemap warning; builds complete successfully.
- Bundled demo snapshots passed SHA-256, date-range and row-count checks.
- Demo inspection and all 500 hidden-scenario calculations passed with Yahoo calls forbidden.
- Existing original Python tests match their prior checksums.

## Release checks

The portable source copy restores platform-specific build dependencies removed by the Linux-only scaffold, while keeping dependency security overrides and the minimum package-release age policy. Fonts and example market histories are local assets, not CDN dependencies.

The ZIP was extracted into a separate `/tmp` directory and its Node dependencies installed using the frozen portable lockfile (428 packages, shared package cache). The extracted app started with its submission launcher and served UI/API from one address. It used the host's already installed Python dependencies; a new operating-system/Python installation has not been tested.

Single-origin smoke results:
- UI root and health route loaded.
- CSV preview and Python validation succeeded.
- The complete demo portfolio valuation returned as of 12 November 2026.
- 2008, 2020 and 2013 replay paths were complete, with recovered results; 1992 was correctly unavailable.
- Risk contribution returned an explicitly **incomplete** source-coverage status, not a fabricated complete result.
- Static scenario and reverse stress returned available results.
- Monte Carlo returned exactly 1,000 paths.
- Rehearsal returned exactly 500 hidden outcomes and all three simulated exposure comparisons.
- CVaR Levels were available for the supplied example and the Crash Card stayed under 120 words.
- Empty portfolio input was rejected with HTTP 400.
- The approximately 3.5 MB submission ZIP passed its archive integrity check.
- The updated cross-platform Node install guard passed a frozen-lockfile install check.

## Browser judge journey

One browser pass uploaded the actual included CSV (not just the sample shortcut). It verified 3 ready rows, no portfolio additions before confirmation, successful Python inspection, and the same holdings across every section without another upload.

- 2020 replay table and timeline scrubbing worked. The final timed browser check also confirmed automatic playback: the scrubber advanced from 1 to 10 after 800 ms, both from Reset and when restarting at the terminal point.
- All four Risk Lab tabs returned results; incomplete coverage and unavailable 1992 history were explicitly disclosed.
- Simulator returned 500 outcomes for a ₹5,000 limit; simulated Sell 25% selection worked without changing the original holdings or Levels.
- Reports displayed the same session results and the clipboard summary succeeded.
- At 402px phone width, the report document had no horizontal overflow. The navigation strip intentionally scrolls horizontally to expose all sections.
- The operating-system PDF save dialog was not automated.

No result here certifies untested operating systems or every possible user CSV/instrument.

## Final GitHub source check

A new source-only copy was assembled from Git-visible files, with no `node_modules` or generated `dist` folders. Its frozen-lockfile install and `scripts/build-submission.mjs` both passed on Linux. Starting before the build gave explicit recovery commands instead of a broken preview.

After building, `scripts/start-submission.mjs` served both UI and API from one origin, and the full smoke script passed: valuation, CSV/input validation, three historical replay windows, static/reverse stress, 1,000 Monte Carlo paths, 500 hidden outcomes, certified Levels and Crash Card. The 1992 window and incomplete source coverage stayed clearly labeled. All 85 Python tests, 15 UI/helper tests and workspace type checks also passed again.

The repository now permits platform-native build dependencies, not just the exported ZIP. Security overrides and the one-day package-release-age policy remain enabled. Native Windows/macOS runs and a new Python installation remain unverified. This was a local source-checkout simulation, not confirmation that code has been pushed to a GitHub repository.

The final fresh browser pass uploaded the actual demo CSV while a temporary fetch wrapper deliberately rejected the old `/api/portfolio/csv-preview` endpoint. The preview still showed all three ready rows and made **zero** calls to that endpoint. No holdings were added before confirmation. The same holdings then worked through Crash Analytics, all four Risk Lab tabs, Simulator and Reports. Clipboard sharing worked, the simplified footer was visible, and the 402px phone document had no horizontal overflow. Navigation scrolls horizontally on a phone; PDF/OS print saving was intentionally not automated.

## Known limits

- Python 3.13+, Node.js 24, pnpm 10.26.1 and initial internet access to install dependencies are required.
- Windows and macOS native execution have not been verified on those operating systems.
- Demo snapshots are source observations, not independently audited exchange data or live prices. See their manifest and `SUBMISSION.md`.
- 1992 replay for the example stocks is unavailable because their history begins later. Coverage gaps remain disclosed.
- Custom symbols outside the bundled demo need Yahoo/network access; provider outages can produce explicit unavailable results.
- Portfolio input is session-only and clears on reload. Clipboard and PDF dialogs depend on browser permissions.
