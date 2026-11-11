import { useEffect, useRef, useState } from 'react';
import { ChartPie, ChevronDown, CircleHelp, FlaskConical, History, LoaderCircle, Play, Table2, TrendingUp, Waves, ChartLine } from 'lucide-react';
import { useAnalyzePortfolioRisk, useGetStaticScenarios, useRunPortfolioStress } from '@workspace/api-client-react';
import type {
  MonteCarloResult, PortfolioHolding, PortfolioRiskAnalysisReport, PortfolioStressInput, PortfolioStressReport, RiskInstrumentCoverage,
} from '@workspace/api-client-react';
import './risk-lab.css';

type Tab = 'paths' | 'reverse' | 'contributors' | 'recovery';
const tabs: { id: Tab; label: string; icon: typeof ChartLine }[] = [
  { id: 'paths', label: 'Explore Possible Paths', icon: ChartLine },
  { id: 'reverse', label: 'Reverse Stress Testing', icon: Waves },
  { id: 'contributors', label: 'Risk Contributors', icon: ChartPie },
  { id: 'recovery', label: 'Recovery Time', icon: History },
];
const donutColors = ['#f26a1b', '#4c8dff', '#93ccff', '#ffb694', '#aec6ff', '#e1c0b2'];

const inr = (v: number | null | undefined) => v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v}%`;
function errText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The analysis service could not complete this request.';
}

function Coverage({ items, title }: { items: RiskInstrumentCoverage[]; title: string }) {
  if (!items.length) return null;
  return <details className="rl-cov">
    <summary>{title} <ChevronDown size={14} /></summary>
    <table className="rl-table"><thead><tr><th>Holding</th><th>History</th><th>Source symbol</th><th>Coverage</th><th>Note</th></tr></thead>
      <tbody>{items.map((i) => <tr key={i.ticker}><td>{i.ticker}</td><td><span className={`rl-chip ${i.dataType}`}>{i.dataType === 'observed' ? 'Observed' : i.dataType === 'proxy' ? `Proxy${i.proxyInstrument ? `: ${i.proxyInstrument}` : ''}` : 'Insufficient'}</span></td><td>{i.sourceSymbol ?? '—'}</td><td>{i.coverageStart ?? '—'} – {i.coverageEnd ?? '—'}</td><td>{i.note}</td></tr>)}</tbody></table>
  </details>;
}

function PathsCanvas({ mc, selected }: { mc: MonteCarloResult; selected: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || mc.plotMinInr === null || mc.plotMaxInr === null) return;
    const lo = mc.plotMinInr, span = (mc.plotMaxInr - mc.plotMinInr) || 1;
    const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#31353f'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((f) => { ctx.beginPath(); ctx.moveTo(0, h * f); ctx.lineTo(w, h * f); ctx.stroke(); });
    ctx.setLineDash([]);
    // Rendering only: map Python values to canvas coordinates.
    const line = (vals: number[]) => { ctx.beginPath(); vals.forEach((v, i) => { const x = (i / Math.max(vals.length - 1, 1)) * w; const y = h - ((v - lo) / span) * h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); };
    ctx.strokeStyle = 'rgba(76,141,255,0.07)'; ctx.lineWidth = 1;
    mc.paths.forEach((p) => line(p.valuesInr));
    const sel = mc.paths[selected];
    if (sel) { ctx.strokeStyle = '#f26a1b'; ctx.lineWidth = 2; line(sel.valuesInr); }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(c);
    return () => observer.disconnect();
  }, [mc, selected]);
  return <canvas ref={ref} className="rl-canvas" role="img" aria-label={`All ${mc.paths.length} simulated paths drawn; path ${selected} highlighted.`} data-testid="canvas-monte-carlo" />;
}

export function RiskLab({ holdings, inspectionKey, onCompleted }: { holdings: PortfolioHolding[]; inspectionKey?: string; onCompleted?: () => void }) {
  const library = useGetStaticScenarios();
  const stress = useRunPortfolioStress();
  const risk = useAnalyzePortfolioRisk();
  const stressReq = useRef(0);
  const riskReq = useRef(0);
  const [tab, setTab] = useState<Tab>('paths');
  const [pathsView, setPathsView] = useState<'chart' | 'table'>('chart');
  const [contribView, setContribView] = useState<'chart' | 'table'>('chart');
  const [scenarioId, setScenarioId] = useState('');
  const [target, setTarget] = useState('20');
  const [stockShock, setStockShock] = useState('');
  const [etfShock, setEtfShock] = useState('');
  const [stressReport, setStressReport] = useState<PortfolioStressReport>();
  const [stressError, setStressError] = useState('');
  const [riskReport, setRiskReport] = useState<PortfolioRiskAnalysisReport>();
  const [riskError, setRiskError] = useState('');
  const [selected, setSelected] = useState(0);

  const lib = library.data;
  const activeId = scenarioId || lib?.scenarios[0]?.id || '';
  const locked = !inspectionKey || !holdings.length;

  const runStress = () => {
    if (locked || !activeId || stress.isPending) return;
    const data: PortfolioStressInput = { holdings, scenarioId: activeId, targetLossPct: target.trim() };
    const overrides: { stockShockPct?: string; etfShockPct?: string } = {};
    if (stockShock.trim()) overrides.stockShockPct = stockShock.trim();
    if (etfShock.trim()) overrides.etfShockPct = etfShock.trim();
    if (Object.keys(overrides).length) data.overrides = overrides;
    const id = ++stressReq.current;
    setStressReport(undefined); setStressError('');
    stress.mutate({ data }, {
      onSuccess: (r) => { if (id === stressReq.current) { setStressReport(r); setSelected(0); if (r.scenario.status === 'available' || r.reverseStress.status === 'available' || r.monteCarlo.status !== 'unavailable') onCompleted?.(); } },
      onError: (e) => { if (id === stressReq.current) setStressError(errText(e)); },
    });
  };
  const runRisk = () => {
    if (locked || risk.isPending) return;
    const id = ++riskReq.current;
    setRiskReport(undefined); setRiskError('');
    risk.mutate({ data: { holdings } }, {
      onSuccess: (r) => { if (id === riskReq.current) { setRiskReport(r); if (r.riskContribution.status !== 'unavailable') onCompleted?.(); } },
      onError: (e) => { if (id === riskReq.current) setRiskError(errText(e)); },
    });
  };
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); stressReq.current++; setStressReport(undefined); setStressError(''); };

  const mc = stressReport?.monteCarlo;
  const rv = stressReport?.reverseStress;
  const rc = riskReport?.riskContribution;
  const pathCountLabel = mc ? `${mc.paths.length.toLocaleString('en-IN')} Simulations` : lib ? `${lib.simulation.pathCount.toLocaleString('en-IN')} Configured Simulations` : 'Simulations';
  const horizon = mc?.config.horizonTradingDays ?? lib?.simulation.horizonTradingDays;
  const engine = stress.isPending || risk.isPending ? 'RUNNING' : library.isError ? 'UNREACHABLE' : library.isLoading ? 'CHECKING' : locked ? 'AWAITING INSPECTION' : 'READY';

  const stressGate = (label: string) => locked ? <div className="rl-empty">Confirm and inspect your holdings on Portfolio first. Nothing runs before that.</div>
    : stress.isPending ? <div className="rl-empty"><LoaderCircle className="rl-spin" size={20} /> Running the simulation in the analysis service…</div>
    : stressError ? <div className="rl-empty rl-err">{stressError} <button type="button" className="rl-link" onClick={runStress} data-testid="button-retry-stress">Try again</button></div>
    : <div className="rl-empty">No simulated output yet. <button type="button" className="rl-btn" onClick={runStress} disabled={!activeId} data-testid="button-run-stress"><Play size={14} /> {label}</button></div>;
  const riskGate = locked ? <div className="rl-empty">Confirm and inspect your holdings on Portfolio first. Nothing runs before that.</div>
    : risk.isPending ? <div className="rl-empty"><LoaderCircle className="rl-spin" size={20} /> Analysing your holdings' history…</div>
    : riskError ? <div className="rl-empty rl-err">{riskError} <button type="button" className="rl-link" onClick={runRisk} data-testid="button-retry-risk">Try again</button></div>
    : <div className="rl-empty">No analysis yet. <button type="button" className="rl-btn" onClick={runRisk} data-testid="button-run-risk"><Play size={14} /> Analyze holdings</button></div>;

  // Donut rendering from Python contributionPct (only positive shares drawn; table shows all values).
  let offset = 0;
  const C = 251.2;
  const positive = rc ? rc.contributions.filter((x) => x.contributionPct > 0) : [];
  const hasNegativeContribution = rc?.contributions.some((x) => x.contributionPct < 0);

  return <div className="rl">
    <header className="rl-card rl-head">
      <div className="rl-head-l">
        <span className="rl-ic"><FlaskConical size={24} /></span>
        <div><div className="rl-kicker">RISK LAB // PORTFOLIO STRESS TESTING</div><h1 className="rl-h-lg">Portfolio Risk &amp; Stress Lab</h1></div>
      </div>
      <span className="rl-engine" data-testid="text-engine-status">SIMULATION ENGINE: {engine}</span>
    </header>

    <details className="rl-card rl-explain">
      <summary><CircleHelp size={20} /><span>How This Works: Portfolio Risk &amp; Stress Terminology</span><ChevronDown size={18} className="rl-chev" /></summary>
      <div className="rl-terms">
        <div><b>Volatility</b><p>How widely the portfolio's daily returns swing, measured from the available price history.</p></div>
        <div><b>Simulated paths</b><p>Possible shapes built by resampling blocks of past joint returns. Simulated, not observed prices and not forecasts.</p></div>
        <div><b>Drawdown</b><p>The percentage fall from a peak value to the following low point.</p></div>
      </div>
    </details>

    <nav className="rl-card rl-tabs" role="tablist">
      {tabs.map((t) => { const I = t.icon; return <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)} data-testid={`tab-risklab-${t.id}`}><I size={18} /><span>{t.label}</span></button>; })}
    </nav>

    {tab === 'paths' && <section className="rl-card rl-xl">
      <div className="rl-sec-head">
        <div><div className="rl-kicker rl-mono">MONTE CARLO SIMULATION MODEL</div><h2 className="rl-h-xl">Simulated Portfolio Paths ({pathCountLabel})</h2></div>
        <button type="button" className="rl-toggle" onClick={() => setPathsView((v) => v === 'chart' ? 'table' : 'chart')} disabled={!mc} data-testid="button-toggle-paths"><Table2 size={16} /> {pathsView === 'chart' ? 'Switch to Table View' : 'Switch to Chart View'}</button>
      </div>
      {!mc ? <div className="rl-plot">{stressGate('Run simulation')}</div>
        : pathsView === 'chart' ? <div className="rl-plot">
          <div className="rl-plot-top"><span className="rl-sec">PORTFOLIO VALUE (₹), SIMULATED</span><span className="rl-pri">TIME HORIZON: {horizon} TRADING DAYS</span></div>
          {mc.paths.length && mc.plotMinInr !== null && mc.plotMaxInr !== null ? <>
            <div className="rl-canvas-wrap"><PathsCanvas mc={mc} selected={selected} /></div>
            <div className="rl-axis"><span>DAY 0 (NOW)</span><span>{inr(mc.plotMinInr)} – {inr(mc.plotMaxInr)}</span><span>DAY {horizon}</span></div>
          </> : <div className="rl-empty">Simulation {mc.status}: no paths returned for these holdings.</div>}
        </div> : <div className="rl-table-wrap">
          <table className="rl-table"><thead><tr><th>Terminal percentile</th><th>Simulated value at day {horizon}</th></tr></thead>
            <tbody>{mc.terminalPercentiles.length ? mc.terminalPercentiles.map((p) => <tr key={p.percentile}><td>{p.percentile}th percentile</td><td>{inr(p.valueInr)}</td></tr>) : <tr><td colSpan={2}>No terminal percentiles returned.</td></tr>}</tbody></table>
        </div>}
      {mc && mc.paths.length > 0 && <div className="rl-path-pick">
        <label><span>Highlight simulated path (0 – {mc.paths.length - 1})</span><input type="range" min={0} max={mc.paths.length - 1} value={selected} onChange={(e) => setSelected(Number(e.target.value))} data-testid="input-path-slider" /></label>
        <p>Path {mc.paths[selected]?.id}: {inr(mc.paths[selected]?.valuesInr[0])} at day 0, {inr(mc.paths[selected]?.valuesInr[mc.paths[selected].valuesInr.length - 1])} at day {horizon}.</p>
      </div>}
      {mc && <div className="rl-kv">
        <div><span>Status</span><b>{mc.status}</b></div>
        <div><span>Paths / horizon</span><b>{mc.config.pathCount} / {mc.config.horizonTradingDays} days</b></div>
        <div><span>Block / seed</span><b>{mc.config.blockTradingDays} days / {mc.config.seed}</b></div>
        <div><span>Simulated loss probability</span><b>{pct(mc.lossProbabilityPct)}</b></div>
        <div><span>Underlying history</span><b>{mc.historyKind}</b></div>
        <div><span>Coverage</span><b>{mc.coverageStart ?? '—'} – {mc.coverageEnd ?? '—'}</b></div>
        <div><span>Source / as of</span><b>{stressReport?.source} / {stressReport?.valuationDate ?? '—'}</b></div>
        <div><span>Start value</span><b>{inr(stressReport?.portfolioValueInr)}</b></div>
      </div>}
      {mc && <Coverage items={mc.instruments} title="Underlying history per holding" />}
      {mc && mc.notes.map((n, k) => <p key={k} className="rl-note">{n}</p>)}
    </section>}

    {tab === 'reverse' && <section className="rl-card rl-xl">
      <div className="rl-sec-head"><div><div className="rl-kicker rl-mono">REVERSE STRESS ENGINE</div><h2 className="rl-h-xl">Scenario Depth Matrix &amp; Breaking Points</h2></div></div>
      <div className="rl-rev">
        <div className="rl-target">
          <div className="rl-label rl-mute">TARGET PORTFOLIO LOSS</div>
          <div className="rl-big" data-testid="text-target-loss">{rv ? `-${rv.targetLossPct}%` : target.trim() ? `-${target.trim()}%` : '—'}</div>
          <p className="rl-mute">{rv ? 'As validated by the analysis service.' : 'Hypothetical loss you name; the service validates it.'}</p>
          <label><span>Target loss %</span><input value={target} onChange={(e) => edit(setTarget)(e.target.value)} inputMode="decimal" data-testid="input-target-loss" /></label>
          <label><span>Static scenario</span><select value={activeId} onChange={(e) => edit(setScenarioId)(e.target.value)} disabled={!lib} data-testid="select-scenario">{lib?.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <div className="rl-two">
            <label><span>Stock shock %</span><input value={stockShock} onChange={(e) => edit(setStockShock)(e.target.value)} placeholder="Scenario default" data-testid="input-stock-shock" /></label>
            <label><span>ETF shock %</span><input value={etfShock} onChange={(e) => edit(setEtfShock)(e.target.value)} placeholder="Scenario default" data-testid="input-etf-shock" /></label>
          </div>
          {lib && <p className="rl-note">Bounds {lib.shockBoundsPct.min}% to {lib.shockBoundsPct.max}%; values outside are clamped by the service and reported.</p>}
          <button type="button" className="rl-btn" onClick={runStress} disabled={locked || !activeId || stress.isPending} data-testid="button-run-reverse">{stress.isPending ? <LoaderCircle className="rl-spin" size={14} /> : <Play size={14} />} Run stress</button>
        </div>
        <div className="rl-table-wrap">
          <table className="rl-table"><thead><tr><th>Shock Scenario</th><th>Stock / ETF Shock</th><th>Scenario Impact</th><th>Status</th></tr></thead>
            <tbody>
              {library.isLoading && <tr><td colSpan={4}>Loading static scenarios…</td></tr>}
              {library.isError && <tr><td colSpan={4}>Scenario library unavailable. <button type="button" className="rl-link" onClick={() => library.refetch()}>Retry</button></td></tr>}
              {lib?.scenarios.map((s) => {
                const res = stressReport?.scenario.id === s.id ? stressReport.scenario : undefined;
                return <tr key={s.id} className={s.id === activeId ? 'is-sel' : ''}><td><b>{s.name}</b><small>{s.description}</small></td>
                  <td>{res ? `${res.stockShockPct}% / ${res.etfShockPct}%` : `${s.stockShockPct}% / ${s.etfShockPct}%`}</td>
                  <td className="rl-pri">{res ? `${pct(res.lossPct)} (${inr(res.impactInr)})` : '—'}</td>
                  <td>{res ? res.status : s.id === activeId ? 'Selected' : 'Not run'}</td></tr>;
              })}
            </tbody></table>
          {stressReport?.scenario.notes.map((n, k) => <p key={k} className="rl-note">{n}</p>)}
        </div>
      </div>
      {!rv ? (locked || stress.isPending || stressError ? stressGate('Run stress') : null) : <div className="rl-rev-out">
        <div className="rl-kv">
          <div><span>Reverse stress</span><b>{rv.status}</b></div>
          <div><span>Target loss (₹)</span><b>{inr(rv.targetLossInr)}</b></div>
          <div><span>Scenario pattern multiplier</span><b>{rv.scaleMultiplier ?? '—'}</b></div>
          <div><span>Resulting loss</span><b>{pct(rv.lossPct)} / {inr(rv.impactInr)}</b></div>
        </div>
        {rv.holdings.length > 0 && <table className="rl-table"><thead><tr><th>Holding</th><th>Shock</th><th>Impact</th><th>Stressed value</th></tr></thead>
          <tbody>{rv.holdings.map((h) => <tr key={`${h.exchange}:${h.ticker}`}><td>{h.ticker}</td><td>{h.shockPct}%</td><td>{inr(h.impactInr)}</td><td>{inr(h.stressedValueInr)}</td></tr>)}</tbody></table>}
        {rv.notes.map((n, k) => <p key={k} className="rl-note">{n}</p>)}
        <p className="rl-note">Hypothetical static shocks from a JSON scenario library; not observed events and not probabilities.</p>
      </div>}
    </section>}

    {tab === 'contributors' && <section className="rl-card rl-xl">
      <div className="rl-sec-head">
        <div><div className="rl-kicker rl-mono">VOLATILITY CONTRIBUTION ANALYSIS</div><h2 className="rl-h-xl">Asset Risk Weighting &amp; Volatility Drivers</h2></div>
        <button type="button" className="rl-toggle" onClick={() => setContribView((v) => v === 'chart' ? 'table' : 'chart')} disabled={!rc} data-testid="button-toggle-contributors"><Table2 size={16} /> {contribView === 'chart' ? 'Switch to Table View' : 'Switch to Chart View'}</button>
      </div>
      {!rc ? riskGate : !rc.contributions.length ? <div className="rl-empty">Risk contribution {rc.status}. {rc.explanation}</div>
        : contribView === 'chart' && !hasNegativeContribution ? <div className="rl-donut-wrap">
          <div className="rl-donut">
            <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="transparent" stroke="#31353f" strokeWidth="16" />
              {positive.map((x, i) => { const len = (x.contributionPct / 100) * C; const el = <circle key={x.ticker} cx="50" cy="50" r="40" fill="transparent" stroke={donutColors[i % donutColors.length]} strokeWidth="16" strokeDasharray={`${len} ${C}`} strokeDashoffset={-offset} />; offset += len; return el; })}
            </svg>
            <div><span>VOLATILITY</span><b>{pct(rc.annualizedVolatilityPct)}</b></div>
          </div>
          <ul className="rl-legend">{rc.contributions.map((x) => <li key={x.ticker}><i style={{ background: x.contributionPct > 0 ? donutColors[positive.indexOf(x) % donutColors.length] : '#31353f' }} /><span>{x.ticker}</span><small>{x.contributionPct}% Risk Contribution</small></li>)}</ul>
        </div> : <div className="rl-table-wrap"><table className="rl-table"><thead><tr><th>Asset Name</th><th>Portfolio Share</th><th>Annualized Contribution</th><th>Risk Contribution Share</th></tr></thead>
          <tbody>{rc.contributions.map((x) => <tr key={x.ticker}><td>{x.ticker} <small>{x.instrumentType.toUpperCase()}</small></td><td>{x.latestWeightPct}%</td><td>{x.annualizedContributionPct}%</td><td className="rl-pri">{x.contributionPct}%</td></tr>)}</tbody></table></div>}
      {rc && <>
        {hasNegativeContribution && <p className="rl-note">Signed contributions are shown in the table: a donut cannot represent negative contributions accurately.</p>}
        <div className="rl-kv"><div><span>Status</span><b>{rc.status}</b></div><div><span>Coverage</span><b>{rc.coverageStart ?? '—'} – {rc.coverageEnd ?? '—'}</b></div><div><span>Observations</span><b>{rc.observationCount}</b></div><div><span>Source</span><b>{riskReport?.source}</b></div></div>
        {rc.contributions.length > 0 && <p className="rl-note">{rc.explanation}</p>}
        <Coverage items={rc.instruments} title="History used per holding" />
        {rc.notes.map((n, k) => <p key={k} className="rl-note">{n}</p>)}
      </>}
    </section>}

    {tab === 'recovery' && <section className="rl-card rl-xl">
      <div className="rl-sec-head"><div><div className="rl-kicker rl-mono">DRAWDOWN RECOVERY HORIZON</div><h2 className="rl-h-xl">Time-to-Peak Recovery Matrix</h2></div></div>
      {!riskReport ? riskGate : <div className="rl-table-wrap">
        <table className="rl-table"><thead><tr><th>Past Window</th><th>Max Drawdown</th><th>Recovery Time</th><th>Recovery Status</th></tr></thead>
          <tbody>{riskReport.replayWindows.map((w) => <tr key={w.id}><td><b>{w.name}</b><small>{w.startDate} – {w.endDate} · coverage {w.coverageStart ?? '—'} – {w.coverageEnd ?? '—'}</small></td><td className="rl-pri">{pct(w.maxDrawdownPct)}</td><td>{w.recoveryTradingDays === null ? '—' : `${w.recoveryTradingDays} trading days`}</td><td>{w.recoveryStatus === 'not_recovered' ? 'Not recovered in available history' : w.recoveryStatus.replaceAll('_', ' ')}{w.recoveryDate ? ` (${w.recoveryDate})` : ''}</td></tr>)}</tbody></table>
        <p className="rl-note">Recovery counts trading days from the drawdown trough until the prior peak is regained. Hypothetical replay of your current holdings over observed past prices (or labelled proxies); not your account history and not a forecast. Source: {riskReport.source} (prototype). Analysed at {riskReport.checkedAt}.</p>
        {riskReport.replayWindows.map((w) => <Coverage key={w.id} items={w.instruments} title={`${w.name}: history per holding`} />)}
      </div>}
    </section>}

    <p className="rl-foot"><TrendingUp size={12} /> All outputs are simulated or hypothetical, computed by the analysis service from a prototype Yahoo Finance source. Educational only; no advice, no trading.</p>
  </div>;
}
