import type { PortfolioHolding, ReplayWindowResult, RiskInstrumentCoverage } from '@workspace/api-client-react';

// Non-financial label for Python recovery status; never implies zero days.
export function recoveryText(w: ReplayWindowResult): string {
  if (w.recoveryStatus === 'recovered') return w.recoveryTradingDays !== null ? `${w.recoveryTradingDays} trading days` : 'Recovered (days not returned)';
  if (w.recoveryStatus === 'not_recovered') return 'Not recovered in available history';
  if (w.recoveryStatus === 'incomplete') return 'Incomplete: history or date alignment prevents a reliable recovery time';
  if (w.maxDrawdownPct === 0 && w.path.length > 1) return 'Not applicable: no drawdown in this window';
  return w.path.length ? 'Recovery unavailable; see source notes' : 'Unavailable: no portfolio path for this window';
}
export type Scoped = { holding: PortfolioHolding; cov?: RiskInstrumentCoverage };
// Coverage is matched to holdings by validated order (Python preserves it); only used when lengths and tickers agree.
export function scopeFor(holdings: PortfolioHolding[], w: ReplayWindowResult): { aligned: boolean; eligible: Scoped[]; blocked: Scoped[] } {
  const aligned = w.instruments.length === holdings.length && w.instruments.every((c, i) => c.ticker === holdings[i].ticker);
  const rows = holdings.map((h, i) => ({ holding: h, cov: aligned ? w.instruments[i] : undefined }));
  return { aligned, eligible: rows.filter((r) => r.cov && r.cov.dataType !== 'insufficient'), blocked: rows.filter((r) => !r.cov || r.cov.dataType === 'insufficient') };
}
