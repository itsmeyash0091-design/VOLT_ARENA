---
name: Vercel hosting boundary
description: Distinguishes a successful static frontend build from a working Python-backed application.
---

Treat Vercel as a frontend target unless a compatible API hosting and routing plan has been explicitly configured. A successful static build is not proof that CSV validation or financial analysis works on the published site.

**Why:** The application needs its existing Node/Python analysis service. The user requested a build-configuration fix without changing financial calculations or API behavior, not a serverless migration.

**How to apply:** Keep the design sandbox out of the production frontend build. Preserve explicit workflow overrides while allowing build-time environment defaults. Never invent an API host, silently substitute financial data, or claim the Python backend is hosted merely because frontend assets built successfully.
