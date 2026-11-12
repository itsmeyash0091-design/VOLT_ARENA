# VoltArena college submission — start here

## What to upload

Upload **VoltArena-MVP-submission.zip**, not screenshots, an HTML file, or a folder of `node_modules`. Keep the ZIP unchanged. It includes the source, prebuilt browser/API files, locked dependency lists, example CSV and dated historical market snapshots.

This is an application, not a document: double-clicking `index.html` cannot run its Python API. Judges need Node.js 24, pnpm 10.26.1 and Python 3.13+ on their computer, or a suitable Replit environment. A first dependency installation needs internet access. No keys, accounts, database or paid API are required.

## Run on a computer

1. Extract the ZIP. Open a terminal in the `VoltArena-MVP` folder.
2. Install Node.js 24 and Python 3.13+ if needed. Install pnpm with `npm install -g pnpm@10.26.1`.
3. Install dependencies:
   ```
   pnpm install --frozen-lockfile
   python3 -m pip install -r requirements.txt
   ```
   On Windows replace `python3` with `python`. If your Python installation refuses system installation, use its documented package setup or a managed environment; do not bypass its protections.
4. Start:
   ```
   node scripts/start-submission.mjs
   ```
5. Keep the terminal open and open **http://localhost:3000** in Chrome, Edge or Firefox. UI and API use this single address; no extra proxy/server configuration is needed.

If Python is installed under another executable, set `PYTHON_BIN` to that executable before starting. If port 3000 is occupied, set `PORT` to another free port and use the printed URL.

The ZIP contains prebuilt app files. To rebuild source changes, run `node scripts/build-submission.mjs` after installing dependencies.

The portable ZIP restores Windows/Mac native dependency choices and uses a Node-based install guard instead of a Unix-only shell command. It has been run on Linux; native Windows/macOS execution is still unverified.

## Import on Replit

Use Replit's ZIP importer at **https://replit.com/import**, select ZIP and upload the submission archive (under 200 MB). Install the locked Node/Python dependencies using the environment's package setup, then run `node scripts/start-submission.mjs`. The importer can assist with runtime setup; imported machines still need Python dependencies. Use the app's running preview, not a source file. The normal project has separate managed UI/API workflows; the portable submission intentionally serves both from one process.

## Three-minute judge walkthrough

1. Portfolio → CSV Upload → select the included **demo-portfolio.csv**. The same file can be downloaded inside the app.
2. Review the 3 rows and column mapping, add them to the session, then **Review & confirm → Confirm and inspect**. Alternatively, Sample Portfolios opens the exact built-in CSV preview.
3. Review valuation, source/as-of dates and price-history diagnostics.
4. Crash Analytics → select 2008 or 2020 → run/replay; play, pause, scrub and inspect the data table.
5. Risk Lab → run Possible Paths, Reverse Stress, Risk Contributors and Recovery Time. Simulations are not future observations.
6. Simulator → enter a loss limit such as ₹5,000 → Run & Reveal. Compare the three **simulated** exposure choices; no holdings or real orders change.
7. Reports → review the Python-generated Crash Card/Levels and copy/export the report. PDF uses the browser's Print → Save as PDF.

Upload once: all pages reuse the same confirmed session holdings. Refreshing or closing the tab clears them, intentionally. Do not enter real personal portfolio information for a public demonstration.

## Demo data: reliable, but not invented

The example CSV has arbitrary teaching quantities of RELIANCE, TCS and INFY, not recommendations or a real person's holdings. Their longest available daily Yahoo histories were captured on **12 November 2026**. Exact capture time, coverage ranges, source fields, row counts and SHA-256 checksums are in:

`artifacts/api-server/python/data/demo-market/manifest.json`

For these three symbols, Python explicitly uses the bundled snapshots, not live prices or a silent synthetic fallback. After setup, their demo analyses do not require Yahoo access. Other instruments require internet/Yahoo availability and can return unavailable results. The snapshots are not independently audited, source adjustments are not independently reconstructed, and no missing prices are filled. Do not claim a snapshot is a live exchange feed. Review provider terms before distributing datasets beyond this educational submission.

1992 replay is unavailable for these instruments because their source histories start later. Gaps can make coverage incomplete. Levels may be unavailable if certification fails. Those are honest data/model limits, not values to force or invent. Past replay of today's holdings is hypothetical.

## Checks and troubleshooting

Run the automated tests:
```
python3 -m unittest discover -s artifacts/api-server/python -p "test_*.py" -q
node --test artifacts/voltarena/src/pages/*.test.ts
pnpm run typecheck
```
With the submission running:
```
python3 scripts/smoke-submission.py http://localhost:3000
```

- CSV preview is local and requires no network request. Malformed files show explicit errors; existing rows are not silently dropped.
- Validation/analysis needs the running Python API. If requests fail, confirm the terminal is running and open `/api/healthz` on the same address.
- A blank page from opening an HTML file means the server was not started.
- Missing Python imports: install `requirements.txt` into the same Python reported by startup.
- Do not move the Python source/data folders away from the API bundle.
- PDF save dialogs and clipboard permissions depend on the browser. Copy fallback text is available.

Tested release evidence is in `docs/submission-verification.md`. No software can promise zero errors on every unknown machine; installation prerequisites, source limitations and platform checks are stated rather than hidden.
