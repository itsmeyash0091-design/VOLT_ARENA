# Vercel frontend build

## Correct production target

- `artifacts/voltarena`: production React/Vite UI.
- `artifacts/api-server`: existing TypeScript API and deterministic Python calculations.
- `artifacts/mockup-sandbox`: design/component preview only; not the production website.

The failed log used root `pnpm run build`, which recursively builds every workspace, including the sandbox. Both Vite configs previously threw when `PORT` or `BASE_PATH` was absent, even for a static build.

## Vercel settings

Keep **Root Directory at the repository root**, not either artifact folder. The root `vercel.json` sets:

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm run build:vercel` |
| Output Directory | `artifacts/voltarena/dist/public` |

That command checks the shared TypeScript libraries and builds only the production UI. It does not build the sandbox or pretend to host the API. `PORT` and `BASE_PATH` are not required. Managed workflows can still supply them; local Vite defaults are 5173 for VoltArena, 5174 for the sandbox, and `/` for the base path.

Reproduce the configured build on Linux:

```
env -u PORT -u BASE_PATH pnpm run build:vercel
```

Check the original command from the failed log:

```
env -u PORT -u BASE_PATH pnpm run build
```

Run the focused config regression tests:

```
node --test scripts/test-vite-build-config.mjs
```

The generic root build is retained for whole-workspace verification. The sandbox is now safe to build without runtime environment injection.

## Verification result

Verified locally on 12 November 2026 with both `PORT` and `BASE_PATH` removed from the build environment:

- `pnpm run build:vercel`: exit 0; built only VoltArena's UI, not the sandbox or API.
- `pnpm run build` (the exact command in the failed Vercel log): exit 0; the sandbox, API and UI all completed.
- Six focused config tests passed: build/development defaults, managed overrides and rejection of invalid explicit ports for both Vite configs.
- Existing workspace TypeScript checks passed as part of the original root build.

The existing nonfatal tooltip sourcemap warning still appears; it does not fail either build. The `uv` hardlink warning in the supplied screenshot is also not the failing exception. These are local reproductions, not a claim that a new remote Vercel build has already run.

## Backend limitation — important

This Vercel configuration publishes the **frontend only**. It does not convert the existing API into serverless functions, start a persistent Node/Python process, or change financial/API behavior.

The frontend still requests `/api` on its own origin. Before live analysis can work on Vercel, those requests must reach a running compatible API backend, for example through an explicitly configured rewrite to a verified production API host. No backend URL has been invented or hard-coded. Without that routing, local CSV preview works but Python validation and analysis cannot succeed.

For the complete single-server app, use the existing `SUBMISSION.md` startup instructions on a host that supports Node.js and Python. A successful static build alone is not proof that the full financial application is hosted.
