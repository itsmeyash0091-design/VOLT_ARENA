import { useState } from 'react';
import { ClipboardCopy, FileCheck2, Info, Printer } from 'lucide-react';
import type {
  PortfolioInspectReport, PortfolioRiskAnalysisReport, PortfolioStressReport, ResilienceReport,
} from '@workspace/api-client-react';

type Row = { label: string; value: string; kind: 'Observed' | 'Proxy-aware' | 'Hypothetical' | 'Simulated' | 'Analytical' };
type Block = { id: string; title: string; ran: boolean; rows: Row[]; note: string };

const na = 'Not available';
const pct = (v: number | null | undefined) => (v === null || v === undefined ? na : `${v.toLocaleString('en-IN', { maximumFractionDigits: 4 })}%`);
const inr = (v: number | null | undefined) => (v === null || v === undefined ? na : `INR ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const val = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? na : String(v));

function buildBlocks(inspect: PortfolioInspectReport, risk?: PortfolioRiskAnalysisReport, stress?: PortfolioStressReport, res?: ResilienceReport): Block[] {
  return [
    {
      id: 'inspection', title: 'Portfolio inspection', ran: true,
      note: 'Coverage of the price history returned by the source.',
      rows: [
        { label: 'Histories returned', value: `${inspect.summary.succeeded} of ${inspect.summary.requested}`, kind: 'Observed' },
        { label: 'Skipped', value: String(inspect.summary.skipped), kind: 'Observed' },
        { label: 'Source', value: inspect.source, kind: 'Observed' },
        { label: 'Checked at', value: inspect.checkedAt, kind: 'Observed' },
      ],
    },
    {
      id: 'replay', title: 'Crash replay and recovery', ran: !!risk,
      note: 'Current holdings replayed through past windows. Hypothetical: you may not have owned them then.',
      rows: risk ? [
        ...risk.replayWindows.map((w) => ({
          label: w.name,
          value: `max drawdown ${pct(w.maxDrawdownPct)} · recovery ${w.recoveryStatus === 'not_recovered' ? 'not recovered in available history' : w.recoveryStatus.replaceAll('_', ' ')}${w.recoveryTradingDays !== null ? ` (${w.recoveryTradingDays} trading days)` : ''}`,
          kind: 'Hypothetical' as const,
        })),
        { label: 'Annualized volatility', value: pct(risk.riskContribution.annualizedVolatilityPct), kind: 'Proxy-aware' },
        { label: 'Risk contribution status', value: risk.riskContribution.status, kind: 'Proxy-aware' },
      ] : [],
    },
    {
      id: 'stress', title: 'Scenario, reverse stress and Monte Carlo', ran: !!stress,
      note: 'Static shocks are hypothetical; simulated paths are not observed prices and not forecasts.',
      rows: stress ? [
        { label: 'Scenario', value: `${stress.scenario.name} (${stress.scenario.status})`, kind: 'Hypothetical' },
        { label: 'Scenario loss', value: `${pct(stress.scenario.lossPct)} · ${inr(stress.scenario.impactInr)}`, kind: 'Hypothetical' },
        { label: 'Reverse stress multiplier', value: stress.reverseStress.scaleMultiplier === null ? na : `${stress.reverseStress.scaleMultiplier}x for ${stress.reverseStress.targetLossPct}% target`, kind: 'Hypothetical' },
        { label: 'Simulated paths', value: `${stress.monteCarlo.paths.length} drawn (${stress.monteCarlo.config.pathCount} configured)`, kind: 'Simulated' },
        { label: 'Share of paths ending below start', value: pct(stress.monteCarlo.lossProbabilityPct), kind: 'Simulated' },
      ] : [],
    },
    {
      id: 'levels', title: 'Levels and panic rehearsal', ran: !!res,
      note: 'Levels compare tail loss with an equal-risk benchmark of the same holdings. Not an allocation recommendation.',
      rows: res ? [
        { label: 'Levels', value: res.levels.status === 'available' ? `Level ${val(res.levels.level)} · ${res.levels.label}` : `Unavailable: ${res.levels.reason}`, kind: 'Analytical' },
        { label: 'Current CVaR', value: `${inr(res.levels.currentCvarInr)} · ${pct(res.levels.currentCvarPct)}`, kind: 'Simulated' },
        { label: 'Benchmark CVaR', value: `${inr(res.levels.parCvarInr)} · ${pct(res.levels.parCvarPct)}`, kind: 'Simulated' },
        { label: 'Confidence / horizon', value: `${res.settings.confidencePct}% · ${res.settings.horizonTradingDays} trading days`, kind: 'Analytical' },
        { label: 'Panic rehearsal', value: res.panicGame.status === 'revealed' ? `${val(res.panicGame.withinLimitCount)} of ${res.panicGame.evaluatedScenarioCount} within ${inr(res.panicGame.lossLimitInr)}` : res.panicGame.status, kind: 'Simulated' },
      ] : [],
    },
  ];
}

function toText(blocks: Block[], holdingsCount: number, sampleLoaded: boolean, card?: string) {
  const out = [
    'Echo Fleet summary (for learning only)',
    'No forecasts, no advice, no trades. Values below were returned by the analysis service in this session.',
    `Holdings in session: ${holdingsCount}${sampleLoaded ? ' (includes one marked sample input)' : ''}`,
    '',
  ];
  blocks.forEach((b) => {
    out.push(`## ${b.title}`);
    if (!b.ran) out.push('Not run in this session.');
    b.rows.forEach((r) => out.push(`- ${r.label} [${r.kind}]: ${r.value}`));
    out.push('');
  });
  if (card) out.push('## Crash Card', card);
  return out.join('\n');
}

export function Debrief({ inspect, risk, stress, resilience, holdingsCount, sampleLoaded }: {
  inspect: PortfolioInspectReport; risk?: PortfolioRiskAnalysisReport; stress?: PortfolioStressReport; resilience?: ResilienceReport;
  holdingsCount: number; sampleLoaded: boolean;
}) {
  const [copyState, setCopyState] = useState('');
  const blocks = buildBlocks(inspect, risk, stress, resilience);
  const ranCount = blocks.filter((b) => b.ran).length;

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('unavailable');
      await navigator.clipboard.writeText(toText(blocks, holdingsCount, sampleLoaded, resilience?.crashCard.text));
      setCopyState('Debrief text copied');
    } catch {
      setCopyState('Copy is not available in this browser');
    }
  };

  return <section className="ef-debrief" id="debrief" data-testid="section-debrief">
    <div className="ef-debrief-hero">
      <div>
        <div className="ef-kicker"><FileCheck2 size={13} /> SESSION DEBRIEF // {ranCount} OF {blocks.length} BLOCKS RETURNED</div>
        <h2>Simulation debrief</h2>
        <p>A plain readout of what the analysis service returned in this session. Missing values stay marked as not available. Nothing here is a forecast or a recommendation.</p>
      </div>
      <div className="ef-debrief-actions">
        <button type="button" className="ef-btn ef-btn-primary" onClick={copy} data-testid="button-copy-debrief"><ClipboardCopy size={15} /> Copy debrief text</button>
        <button type="button" className="ef-btn" onClick={() => window.print()} data-testid="button-print-debrief"><Printer size={15} /> Print</button>
      </div>
    </div>
    {copyState && <p className="ef-copy-state" role="status" data-testid="text-debrief-copy-state">{copyState}</p>}
    <div className="ef-debrief-grid">
      {blocks.map((b) => <article key={b.id} className={`ef-debrief-block ${b.ran ? '' : 'is-empty'}`} data-testid={`debrief-block-${b.id}`}>
        <header><strong>{b.title}</strong><span>{b.ran ? 'Returned' : 'Not run'}</span></header>
        <p className="ef-debrief-note">{b.note}</p>
        {b.ran ? (b.rows.length ? <dl>{b.rows.map((r, i) => <div key={`${r.label}-${i}`}><dt>{r.label}<i className={`ef-kind k-${r.kind.toLowerCase().replace(/[^a-z]/g, '')}`}>{r.kind}</i></dt><dd className="mono">{r.value}</dd></div>)}</dl> : <p className="ef-debrief-empty">No figures were returned.</p>)
          : <p className="ef-debrief-empty">Run this station to add its returned figures here.</p>}
      </article>)}
    </div>
    <p className="ef-debrief-foot"><Info size={13} /> Copy and Print use only the values shown above. Nothing is uploaded or stored.</p>
  </section>;
}
