---
name: VoltArena MVP decisions
description: Product scope, data provenance, calculation ownership, and safety boundaries for VoltArena.
---

VoltArena's MVP is for Indian listed stocks and ETFs. Portfolio input is CSV or manual entry and personal portfolio data is session-only. Python is the single source of truth for all financial calculations and displayed figures; the TypeScript app calls the Python engine and must not duplicate calculations.

Use Yahoo Finance through yfinance only as a free prototype data source. Show source, as-of date, and actual history coverage. Label sector-index proxies for stocks and insufficient history; never present missing or modeled prices as observed. Keep calculations deterministic. No paid APIs, broker connections, trading, authentication, persistent personal-portfolio storage, LLM scenarios, or buy/sell advice belong in the MVP.

**Why:** The user explicitly approved these project-specific constraints for the VoltArena MVP.

**How to apply:** Preserve these boundaries in future implementation, testing, and release decisions; ask before expanding the product beyond this MVP.
