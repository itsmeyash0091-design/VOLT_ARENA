import { useRef, useState } from 'react';
import { BadgeCheck, ChevronDown, CloudLightning, Compass, Copy, Download, FileText, FlaskConical, Fingerprint, Leaf, LoaderCircle, Lock, Medal, Play, Shield, ShieldCheck } from 'lucide-react';
import { useAnalyzePortfolioResilience } from '@workspace/api-client-react';
import type { PortfolioHolding, ResilienceReport } from '@workspace/api-client-react';
import './report-page.css';

const inr = (v: number | null | undefined) => v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v}%`;
const kind = (d: string, proxy?: string | null) => d === 'observed' ? 'Observed' : d === 'proxy' ? `Proxy${proxy ? `: ${proxy}` : ''}` : 'Insufficient';
function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') return e.message;
  return 'The analysis service could not build this report.';
}

function summaryText(r: ResilienceReport): string {
  const L = r.levels, pg = r.panicGame, s = r.settings;
  return [
    'VoltArena simulation summary (for learning only; no financial advice, trading or predictions)',
    '',
    r.crashCard.text,
    '',
    `Levels: ${L.status === 'available' ? `Level ${L.level ?? '—'} (${L.label}), score ${pct(L.scorePct)}, current CVaR ${inr(L.currentCvarInr)} (${pct(L.currentCvarPct)}), benchmark CVaR ${inr(L.parCvarInr)} (${pct(L.parCvarPct)}), ratio ${L.ratioToPar ?? '—'}` : `unavailable: ${L.reason}`}`,
    `Rehearsal: ${pg.status}${pg.lossLimitInr !== null ? `, loss limit ${inr(pg.lossLimitInr)}` : ''}${pg.withinLimitCount !== null ? `, ${pg.withinLimitCount}/${pg.evaluatedScenarioCount} hidden scenarios within limit` : ''}${pg.reflection ? `, reflection ${pg.reflection}` : ''}`,
    `Settings: ${s.hiddenScenarioCount} hidden simulated scenarios, ${s.confidencePct}% confidence, ${s.horizonTradingDays} trading days, benchmark: ${s.benchmarkMethod}`,
    `Source: ${r.source} (prototype, may be incomplete). Valuation date ${r.valuationDate ?? '—'}. Checked ${r.checkedAt}.`,
    `History: ${r.historyKind}; coverage ${r.coverageStatus} ${r.coverageStart ?? '—'} to ${r.coverageEnd ?? '—'}.`,
    ...r.instruments.map((i) => `- ${i.ticker}: ${kind(i.dataType, i.proxyInstrument)}, ${i.coverageStart ?? '—'} to ${i.coverageEnd ?? '—'}. ${i.note}`),
    'Assumptions:', ...s.assumptions.map((a) => `- ${a}`),
    ...(r.notes.length ? ['Notes:', ...r.notes.map((n) => `- ${n}`)] : []),
  ].join('\n');
}

export function ReportPage({ holdings, inspectionKey, result, onResult, onReturn }: {
  holdings: PortfolioHolding[]; inspectionKey?: string; result?: ResilienceReport; onResult: (r: ResilienceReport | undefined) => void; onReturn: () => void;
}) {
  const run = useAnalyzePortfolioResilience();
  const req = useRef(0);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<{ ok: boolean; text?: string }>();
  const locked = !inspectionKey || !holdings.length;

  const generate = () => {
    if (locked || run.isPending) return;
    const id = ++req.current;
    setError(''); setShare(undefined);
    run.mutate({ data: { holdings } }, {
      onSuccess: (r) => { if (id === req.current) onResult(r); },
      onError: (e) => { if (id === req.current) setError(errText(e)); },
    });
  };
  const copy = async () => {
    if (!result) return;
    const text = summaryText(result);
    try { await navigator.clipboard.writeText(text); setShare({ ok: true }); }
    catch { setShare({ ok: false, text }); }
  };

  const r = result, L = r?.levels, cc = r?.crashCard;
  const gate = locked ? <p className="rp-body rp-mute">Confirm and inspect your holdings on Portfolio first. Nothing runs before that.</p>
    : run.isPending ? <p className="rp-body rp-mute rp-inline"><LoaderCircle size={18} className="rp-spin" /> Building the debrief in the analysis service…</p>
    : error ? <p className="rp-body rp-err">{error} <button type="button" className="rp-link" onClick={generate} data-testid="button-retry-report">Try again</button></p>
    : <div className="rp-inline"><p className="rp-body rp-mute">No debrief yet. Run the Simulator, or generate one with the service's default settings (no loss limit).</p>
      <button type="button" className="rp-btn-p" onClick={generate} data-testid="button-generate-report"><Play size={16} /> Generate report</button></div>;

  return <div className="rp">
    <header className="rp-card rp-head">
      <div className="rp-head-glow" aria-hidden="true" />
      <div className="rp-head-l">
        <div className="rp-kick"><FileText size={14} /> DEBRIEF // {r ? `CHECKED ${r.checkedAt}` : 'NOT GENERATED'}</div>
        <h1 className="rp-h-xl">Simulation Debrief &amp; Portfolio Impact Analysis</h1>
        <p className="rp-body rp-mute">Review the latest result from the analysis service for your inspected holdings. Figures are simulated or hypothetical, computed in Python from prototype price history.</p>
      </div>
      <div className="rp-actions rp-noprint">
        <button type="button" className="rp-btn-p" onClick={copy} disabled={!r} data-testid="button-share-summary"><Copy size={16} /> Share Debrief Summary</button>
        <button type="button" className="rp-btn-q" onClick={() => { setOpen(true); setTimeout(() => window.print(), 50); }} disabled={!r} data-testid="button-export-pdf"><Download size={16} /> Export PDF</button>
        <small className="rp-mute">Copies plain text locally. Export opens your browser's print dialog; choose "Save as PDF".</small>
      </div>
    </header>
    {share && <div className={`rp-card rp-share rp-noprint ${share.ok ? '' : 'is-err'}`} role="status">
      {share.ok ? 'Debrief summary copied to your clipboard. Nothing was uploaded.' : <>Clipboard access was denied. Select and copy the text below.<textarea readOnly value={share.text} onFocus={(e) => e.target.select()} data-testid="textarea-share-fallback" /></>}
    </div>}

    {!r && <section className="rp-card rp-xl">{gate}</section>}
    <div className="rp-grid">
      <section className="rp-card rp-crash" data-testid="panel-crash-card">
        <div className="rp-row">
          <div><div className="rp-kick rp-pri"><i className="rp-dot" />STRESS TEST PERFORMANCE SUMMARY</div><h3 className="rp-h-md">{cc?.header ?? 'Crash Card not generated'}</h3></div>
          <span className="rp-pill"><BadgeCheck size={14} /> HISTORY: {r ? r.historyKind.toUpperCase() : '—'}</span>
        </div>
        <div className="rp-hero">
          <span className="rp-hero-ic"><Shield size={28} /></span>
          <div className="rp-label rp-mute">Current Simulated Tail Loss (CVaR{r ? `, ${r.settings.confidencePct}%, ${r.settings.horizonTradingDays} days` : ''})</div>
          <div className="rp-big" data-testid="text-current-cvar">{L?.status === 'available' ? inr(L.currentCvarInr) : '—'}</div>
          <div className="rp-body rp-sec">{!r ? 'Not generated. Figures appear only after the analysis service returns a report.' : L?.status === 'available' ? `${pct(L.currentCvarPct)} of portfolio value ${inr(r?.portfolioValueInr)}. Average loss in the worst simulated scenarios; not savings, not a forecast.` : `Unavailable: ${L?.reason}`}</div>
        </div>
        <div className="rp-find">
          <div className="rp-row rp-label"><span>CRASH CARD FINDINGS</span><span className="rp-pri">{cc ? `${cc.findings.length} / 3 · ${cc.wordCount} WORDS` : '— / 3'}</span></div>
          {cc?.findings.length ? cc.findings.map((f, k) => <div key={k} className="rp-f"><span className="rp-f-ic">{[<ShieldCheck key="a" size={18} />, <CloudLightning key="b" size={18} />, <Compass key="c" size={18} />][k]}</span><p className="rp-body">{f}</p></div>)
            : <p className="rp-body rp-mute">{r ? 'No findings returned.' : 'Findings come only from the Python Crash Card once a report is generated.'}</p>}
        </div>
        <div className="rp-foot"><span><Fingerprint size={14} /> {cc?.footer ?? 'No report generated'}</span><span>TEMPLATE {cc?.templateVersion ?? '—'}</span></div>
      </section>

      <div className="rp-side">
        <section className="rp-card rp-xl">
          <div className="rp-row">
            <div><div className="rp-kick rp-sec">ANALYTICAL LEVEL</div><div className="rp-h-md">{!r ? 'Level —' : L?.status === 'available' ? `Level ${L.level ?? '—'} · ${L.label}` : 'Unavailable'}</div></div>
            <div className="rp-r"><div className="rp-h-sm rp-pri">{pct(L?.scorePct)}</div><div className="rp-label rp-mute">RATIO TO BENCHMARK {L?.ratioToPar ?? '—'}</div></div>
          </div>
          <div className="rp-bar"><i style={{ transform: `scaleX(${L?.scorePct != null ? Math.min(Math.max(L.scorePct, 0), 100) / 100 : 0})` }} /></div>
          <p className="rp-small rp-mute">{!r ? 'Not generated. ' : L?.status === 'available' ? `Benchmark CVaR ${inr(L.parCvarInr)} (${pct(L.parCvarPct)}). ` : `${L?.reason} `}Compares your tail loss with a same-holdings, long-only, fully invested, no-leverage benchmark with equal component CVaR {r ? ` (${r.settings.benchmarkMethod})` : ''}. An analytical comparison, not an allocation recommendation.</p>
          {L && L.holdings.length > 0 && <div className="rp-scroll"><table className="rp-table"><thead><tr><th>Holding</th><th>Current wt</th><th>Benchmark wt</th><th>CVaR share</th></tr></thead>
            <tbody>{L.holdings.map((h) => <tr key={`${h.exchange}:${h.ticker}`}><td>{h.ticker}</td><td>{h.currentWeightPct}%</td><td>{h.parWeightPct}%</td><td>{h.parComponentSharePct}%</td></tr>)}</tbody></table></div>}
          <div className="rp-levels">{r?.settings.levels.map((t) => <span key={t.level} className={L?.level === t.level ? 'is-on' : ''}>L{t.level} {t.label}{t.maxRatio !== null ? ` ≤ ${t.maxRatio}` : ''}</span>)}</div>
        </section>
        <section className="rp-card rp-xl">
          <div className="rp-row"><div className="rp-title"><Medal size={20} className="rp-pri" /><span className="rp-h-sm">Badges</span></div><span className="rp-pill">NOT TRACKED</span></div>
          <div className="rp-badges">{[Shield, CloudLightning, Compass].map((I, k) => <div key={k} className="rp-badge"><span><I size={22} /></span><b>Locked</b><small>Not tracked</small></div>)}</div>
          <div className="rp-row rp-small rp-mute"><span className="rp-inline"><Lock size={14} /> Badges and XP are not tracked in this prototype.</span></div>
        </section>
        <section className="rp-card rp-xl">
          <div className="rp-kick rp-sec">SIMULATOR REHEARSAL</div>
          {!r ? <p className="rp-body rp-mute">— Not generated.</p> : <p className="rp-body">{r.panicGame.status === 'unavailable' ? r.panicGame.message : r.panicGame.lossLimitInr === null ? 'No loss limit named (default report).' : `Loss limit ${inr(r.panicGame.lossLimitInr)}: ${r.panicGame.withinLimitCount ?? '—'} / ${r.panicGame.evaluatedScenarioCount} hidden scenarios within limit.`}</p>}
          {r?.panicGame.reflection && <p className="rp-small rp-mute">Reflection: {r.panicGame.reflection}. {r.panicGame.reflectionFeedback}</p>}
        </section>
      </div>
    </div>

    <section className={`rp-card rp-drawer ${open ? 'is-open' : ''}`}>
      <button type="button" className="rp-drawer-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="button-assumptions">
        <span className="rp-title"><span className="rp-hero-ic rp-sm"><FlaskConical size={20} /></span><span><span className="rp-h-sm">Inspect Assumptions &amp; Data Details</span><span className="rp-small rp-mute rp-block">Configuration from the analysis service, data source, coverage and per-holding history.</span></span></span>
        <ChevronDown size={20} className="rp-chev rp-noprint" />
      </button>
      <div className="rp-drawer-body">{!r ? <p className="rp-body rp-mute">Generate report to view returned settings, source, coverage and per-holding history.</p> : <>
        <div className="rp-three">
          <div><div className="rp-label rp-mute">SIMULATION</div><div className="rp-h-sm rp-pri">{r.evaluatedScenarioCount} / {r.settings.hiddenScenarioCount} scenarios</div><p className="rp-small rp-mute">{r.settings.confidencePct}% confidence, {r.settings.horizonTradingDays} trading days, scoring {r.settings.scoringVersion}. Simulated, not observed.</p></div>
          <div><div className="rp-label rp-mute">DATA SOURCE</div><div className="rp-h-sm rp-pri">{r.source}</div><p className="rp-small rp-mute">Prototype source, may be incomplete. Valuation date {r.valuationDate ?? '—'}. {r.validReturnCount} valid returns, {r.excludedIntervalCount} excluded intervals.</p></div>
          <div><div className="rp-label rp-mute">COVERAGE</div><div className="rp-h-sm rp-pri">{r.coverageStatus} · {r.historyKind}</div><p className="rp-small rp-mute">{r.coverageStart ?? '—'} – {r.coverageEnd ?? '—'}</p></div>
        </div>
        <div className="rp-scroll"><table className="rp-table"><thead><tr><th>Holding</th><th>History</th><th>Source symbol</th><th>Coverage</th><th>Note</th></tr></thead>
          <tbody>{r.instruments.map((i) => <tr key={i.ticker}><td>{i.ticker}</td><td>{kind(i.dataType, i.proxyInstrument)}</td><td>{i.sourceSymbol ?? '—'}</td><td>{i.coverageStart ?? '—'} – {i.coverageEnd ?? '—'}</td><td>{i.note}</td></tr>)}</tbody></table></div>
        <ul className="rp-list">{r.settings.assumptions.map((a) => <li key={a}>{a}</li>)}{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </>}</div>
    </section>

    <section className="rp-card rp-zero">
      <div className="rp-title"><span className="rp-hero-ic rp-sm rp-sec"><Leaf size={22} /></span><div><h4 className="rp-h-sm">Learn at your own pace</h4><p className="rp-body rp-mute">No leaderboards or streaks. Explore the results for learning, not financial advice, trading or predictions.</p></div></div>
      <button type="button" className="rp-btn-q rp-noprint" onClick={onReturn} data-testid="button-return-portfolio">Return to Portfolio</button>
    </section>
  </div>;
}
