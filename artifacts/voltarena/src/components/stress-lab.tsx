import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Info, LoaderCircle, RotateCw, ShieldCheck, Waves } from 'lucide-react';
import { useGetStaticScenarios, useRunPortfolioStress } from '@workspace/api-client-react';
import type {
  MonteCarloResult, PortfolioHolding, PortfolioStressInput, PortfolioStressReport,
  RiskInstrumentCoverage, ShockHoldingResult,
} from '@workspace/api-client-react';

function errText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The stress request could not be completed. Please try again.';
}
const fmt = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? 'Not available' : `${v.toLocaleString('en-IN', { maximumFractionDigits: 8 })}${suffix}`);
const inr = (v: number | null | undefined) => (v === null || v === undefined ? 'Not available' : `INR ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

function Tag({ value }: { value: string }) {
  return <span className={`risk-status risk-status-${value.replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>;
}
function M({ label, value }: { label: string; value: string }) {
  return <div className="risk-metric"><span>{label}</span><b>{value}</b></div>;
}
function Notes({ notes, title }: { notes: string[]; title: string }) {
  return <section className="risk-notes"><div className="risk-subheading"><Info size={14} /><strong>{title}</strong></div>
    {notes.length ? <ul>{notes.map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}</ul> : <p>No notes were returned.</p>}</section>;
}
function HoldingsTable({ rows, id }: { rows: ShockHoldingResult[]; id: string }) {
  if (!rows.length) return <div className="risk-no-data">No per-holding impacts were returned.</div>;
  return <div className="risk-table-scroll"><table className="risk-table" data-testid={`table-${id}`}>
    <thead><tr><th>Instrument</th><th>Applied shock</th><th>Impact (INR)</th><th>Stressed value (INR)</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={`${r.ticker}-${i}`}><td><strong>{r.ticker}</strong><small className="risk-instrument-type">{r.exchange}</small></td><td className="mono">{r.shockPct}%</td><td className="mono">{fmt(r.impactInr)}</td><td className="mono">{fmt(r.stressedValueInr)}</td></tr>)}</tbody>
  </table></div>;
}
function Coverage({ items }: { items: RiskInstrumentCoverage[] }) {
  return <section className="risk-coverage"><div className="risk-subheading"><ShieldCheck size={14} /><strong>Simulation history &amp; provenance</strong><span>{items.length}</span></div>
    {items.length ? <div className="risk-coverage-grid">{items.map((item, i) => <div key={`${item.ticker}-${i}`} className={`risk-provenance risk-provenance-${item.dataType}`}>
      <span className="risk-provenance-label">{item.dataType === 'observed' ? 'Observed history' : item.dataType === 'proxy' ? 'Proxy history' : 'Insufficient history'}</span>
      <strong>{item.ticker} <small>{item.instrumentType.toUpperCase()}</small></strong>
      <span className="risk-provenance-source">{item.sourceSymbol ? `Source: ${item.sourceSymbol}` : 'Source symbol not reported'}{item.proxyInstrument ? ` · Proxy: ${item.proxyInstrument}` : ''}</span>
      <span className="risk-provenance-dates">{item.coverageStart && item.coverageEnd ? `${item.coverageStart} — ${item.coverageEnd}` : 'Coverage dates not reported'} · {item.observationCount} observations · {item.missingAlignedObservations} missing aligned</span>
      <p>{item.note}</p></div>)}</div> : <p className="risk-no-data">No per-instrument coverage was returned.</p>}
  </section>;
}

function PathCanvas({ mc, selected }: { mc: MonteCarloResult; selected: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || mc.plotMinInr === null || mc.plotMaxInr === null) return;
    const lo = mc.plotMinInr, hi = mc.plotMaxInr;
    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0a0e17'; ctx.fillRect(0, 0, w, h);
      const span = hi - lo || 1;
      const y = (v: number) => h - 8 - ((v - lo) / span) * (h - 16);
      ctx.strokeStyle = '#262a34'; ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) { const gy = 8 + (g * (h - 16)) / 4; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(174,198,255,0.08)'; ctx.lineWidth = 0.8;
      const line = (vals: number[]) => {
        const step = vals.length > 1 ? w / (vals.length - 1) : 0;
        ctx.beginPath(); vals.forEach((v, i) => (i ? ctx.lineTo(i * step, y(v)) : ctx.moveTo(0, y(v)))); ctx.stroke();
      };
      for (const p of mc.paths) line(p.valuesInr);
      const sel = mc.paths[selected];
      if (sel) { ctx.strokeStyle = '#f26a1b'; ctx.lineWidth = 2; line(sel.valuesInr); }
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(canvas);
    return () => ro.disconnect();
  }, [mc, selected]);
  return <canvas ref={ref} className="stress-canvas" role="img" aria-label={`Chart of all ${mc.paths.length} simulated paths; selected path highlighted. Values are listed in the table below.`} data-testid="canvas-monte-carlo" />;
}

function MonteCarlo({ mc }: { mc: MonteCarloResult }) {
  const [selected, setSelected] = useState(0);
  const [showValues, setShowValues] = useState(false);
  const path = mc.paths[selected];
  return <section className="risk-contribution" data-testid="section-monte-carlo">
    <div className="risk-section-intro"><div><div className="risk-kicker">03 / JOINT-BLOCK SIMULATION</div><h3>Simulated, not observed.</h3></div><Tag value={mc.status} /></div>
    <p className="risk-explanation">These are {mc.paths.length} simulated paths assembled from resampled blocks of past joint returns. They are not observed prices and not forecasts; they show a spread of possible shapes under the stated assumptions.</p>
    <div className="risk-contribution-summary">
      <M label="Horizon (trading days)" value={String(mc.config.horizonTradingDays)} />
      <M label="Path count" value={String(mc.config.pathCount)} />
      <M label="Block length (days)" value={String(mc.config.blockTradingDays)} />
      <M label="Seed" value={String(mc.config.seed)} />
      <M label="History kind" value={mc.historyKind} />
      <M label="Source coverage" value={mc.coverageStart && mc.coverageEnd ? `${mc.coverageStart} — ${mc.coverageEnd}` : 'Not reported'} />
      <M label="Valid returns / eligible blocks" value={`${mc.validReturnCount} / ${mc.eligibleBlockCount}`} />
      <M label="Excluded intervals" value={String(mc.excludedIntervalCount)} />
      <M label="Share of paths ending below start" value={fmt(mc.lossProbabilityPct, '%')} />
    </div>
    {mc.paths.length && mc.plotMinInr !== null && mc.plotMaxInr !== null ? <>
      <div className="stress-chart">
        <div className="stress-axis mono"><span>{inr(mc.plotMaxInr)}</span><span>{inr(mc.plotMinInr)}</span></div>
        <PathCanvas mc={mc} selected={selected} />
        <div className="stress-chart-foot mono"><span>Day 0</span><span>All {mc.paths.length} simulated paths drawn · highlighted: path {path?.id}</span><span>Day {mc.config.horizonTradingDays}</span></div>
      </div>
      <div className="stress-select">
        <label className="field"><span>Inspect simulated path (0 – {mc.paths.length - 1})</span>
          <input type="range" min={0} max={mc.paths.length - 1} value={selected} onChange={(e) => setSelected(Number(e.target.value))} data-testid="input-path-slider" /></label>
        <label className="field stress-path-num"><span>Index</span><input type="number" min={0} max={mc.paths.length - 1} value={selected} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n < mc.paths.length) setSelected(n); }} data-testid="input-path-index" /></label>
        <button className="button-outline" onClick={() => setShowValues((v) => !v)} aria-expanded={showValues} data-testid="button-toggle-path-values">{showValues ? 'Hide' : 'Show'} path values</button>
      </div>
      {path && <p className="stress-path-summary" aria-live="polite" data-testid="text-selected-path">Simulated path {path.id}: starts at {inr(path.valuesInr[0])}, ends at {inr(path.valuesInr[path.valuesInr.length - 1])} after {path.valuesInr.length - 1} trading days.</p>}
      {showValues && path && <div className="risk-table-scroll stress-values"><table className="risk-table" data-testid="table-path-values"><thead><tr><th>Trading day</th><th>Simulated value (INR)</th></tr></thead><tbody>{path.valuesInr.map((v, i) => <tr key={i}><td className="mono">{i}</td><td className="mono">{fmt(v)}</td></tr>)}</tbody></table></div>}
    </> : <div className="risk-no-data">No simulated paths are available to plot.</div>}
    {mc.terminalPercentiles.length > 0 && <div className="risk-table-scroll"><table className="risk-table" data-testid="table-terminal-percentiles"><thead><tr><th>Terminal percentile (simulated)</th><th>Value (INR)</th></tr></thead><tbody>{mc.terminalPercentiles.map((p) => <tr key={p.percentile}><td className="mono">P{p.percentile}</td><td className="mono">{fmt(p.valueInr)}</td></tr>)}</tbody></table></div>}
    <Coverage items={mc.instruments} />
    <Notes notes={mc.notes} title="Simulation notes" />
  </section>;
}

function Report({ r }: { r: PortfolioStressReport }) {
  const s = r.scenario, rv = r.reverseStress;
  return <div className="risk-report" data-testid="stress-report">
    <div className="risk-report-meta">
      <div><span>SOURCE</span><b>{r.source}</b></div>
      <div><span>OBSERVED VALUATION DATE</span><b>{r.valuationDate ?? 'Not available'}</b></div>
      <div><span>PORTFOLIO VALUE</span><b>{inr(r.portfolioValueInr)}</b></div>
      <div><span>CHECKED AT</span><b>{r.checkedAt}</b></div>
    </div>
    <section className="risk-contribution" data-testid="section-scenario-impact">
      <div className="risk-section-intro"><div><div className="risk-kicker">01 / HYPOTHETICAL STATIC SHOCK</div><h3>{s.name}</h3></div><Tag value={s.status} /></div>
      <p className="risk-explanation">{s.description} This is a hypothetical shock from a static library, not historical crash data.</p>
      <div className="risk-contribution-summary">
        <M label="Stock shock applied" value={`${s.stockShockPct}%`} />
        <M label="ETF shock applied" value={`${s.etfShockPct}%`} />
        <M label="Impact" value={inr(s.impactInr)} />
        <M label="Loss" value={fmt(s.lossPct, '%')} />
        <M label="Stressed value" value={inr(s.stressedValueInr)} />
      </div>
      {s.adjustments.length > 0 && <div className="stress-notice" role="note"><AlertCircle size={15} /><div><strong>Inputs were adjusted</strong>{s.adjustments.map((a, i) => <p key={i}>{a}</p>)}</div></div>}
      <HoldingsTable rows={s.holdings} id="scenario-holdings" />
      <Notes notes={s.notes} title="Scenario notes" />
    </section>
    <section className="risk-contribution" data-testid="section-reverse-stress">
      <div className="risk-section-intro"><div><div className="risk-kicker">02 / REVERSE STRESS</div><h3>How far would this pattern need to go?</h3></div><Tag value={rv.status} /></div>
      <p className="risk-explanation">The smallest multiplier of the selected static non-positive shock pattern that reaches the target loss, within library floors. Hypothetical, not a prediction.</p>
      <div className="risk-contribution-summary">
        <M label="Target loss" value={`${rv.targetLossPct}%`} />
        <M label="Target loss (INR)" value={inr(rv.targetLossInr)} />
        <M label="Scale multiplier" value={fmt(rv.scaleMultiplier, 'x')} />
        <M label="Resulting impact" value={inr(rv.impactInr)} />
        <M label="Resulting loss" value={fmt(rv.lossPct, '%')} />
        <M label="Stressed value" value={inr(rv.stressedValueInr)} />
      </div>
      {rv.status === 'available' && <HoldingsTable rows={rv.holdings} id="reverse-holdings" />}
      <Notes notes={rv.notes} title={rv.status === 'unavailable' ? 'Why reverse stress is unavailable' : 'Reverse stress notes'} />
    </section>
    <MonteCarlo mc={r.monteCarlo} />
    <Notes notes={r.methodNotes} title="Method notes" />
    <p className="risk-disclaimer"><Info size={14} /> Every figure is returned by the Python service. Static shocks are hypothetical; simulated paths are neither observed history nor forecasts. Nothing here is a recommendation to trade.</p>
  </div>;
}

export function StressLab({ holdings, onResult }: { holdings: PortfolioHolding[]; onResult?: (r: PortfolioStressReport | undefined) => void }) {
  const library = useGetStaticScenarios();
  const stress = useRunPortfolioStress();
  const [scenarioId, setScenarioId] = useState('');
  const [stockShock, setStockShock] = useState('');
  const [etfShock, setEtfShock] = useState('');
  const [target, setTarget] = useState('20');
  const [result, setResult] = useState<PortfolioStressReport>();
  const [error, setError] = useState('');
  const holdingsKey = JSON.stringify(holdings);
  const reqId = useRef(0);
  const lib = library.data;
  const activeId = scenarioId || lib?.scenarios[0]?.id || '';
  const scenario = useMemo(() => lib?.scenarios.find((s) => s.id === activeId), [lib, activeId]);

  const invalidate = () => { reqId.current++; setResult(undefined); setError(''); stress.reset(); };
  const resetRef = useRef(invalidate); resetRef.current = invalidate;
  useEffect(() => { resetRef.current(); }, [holdingsKey]);

  const run = () => {
    if (!activeId || stress.isPending || !holdings.length) return;
    const overrides: { stockShockPct?: string; etfShockPct?: string } = {};
    if (stockShock.trim()) overrides.stockShockPct = stockShock.trim();
    if (etfShock.trim()) overrides.etfShockPct = etfShock.trim();
    const data: PortfolioStressInput = { holdings, scenarioId: activeId, targetLossPct: target.trim() };
    if (Object.keys(overrides).length) data.overrides = overrides;
    const id = ++reqId.current;
    setResult(undefined); setError('');
    stress.mutate({ data }, {
      onSuccess: (r) => { if (id === reqId.current) setResult(r); },
      onError: (e) => { if (id === reqId.current) setError(errText(e)); },
    });
  };
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); invalidate(); };
  const bounds = lib?.shockBoundsPct;
  const onResultRef = useRef(onResult); onResultRef.current = onResult;
  useEffect(() => { onResultRef.current?.(result); }, [result]);

  return <section className="risk-analysis-section stress-section enter" id="stress-lab" aria-busy={stress.isPending} data-testid="section-stress-lab">
    <div className="risk-analysis-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule" /> STAGE 03 / STRESS &amp; SIMULATION</div>
        <h2>Rehearse the <em>loss.</em></h2>
        <p>Apply a hypothetical static shock, find how far its pattern must stretch to reach a loss you name, and look at simulated paths. For understanding only — nothing here suggests a trade.</p>
      </div>
      <span className="risk-session-mark"><ShieldCheck size={14} /> SESSION ONLY</span>
    </div>

    {library.isLoading ? <div className="risk-loading" role="status"><span className="risk-loading-bars"><i /><i /><i /><i /></span><div><strong>Loading scenario library</strong><p>Fetching the checked-in hypothetical scenarios.</p></div></div>
      : library.isError || !lib ? <div className="risk-error" role="alert"><AlertCircle size={17} /><div><strong>Scenario library could not be loaded</strong><p>{errText(library.error)}</p></div><button onClick={() => { void library.refetch(); }} data-testid="button-retry-scenarios">Try again <RotateCw size={13} /></button></div>
      : !lib.scenarios.length ? <div className="risk-no-data">The scenario library returned no scenarios.</div>
      : <div className="stress-form">
        <div className="stress-scenarios" role="radiogroup" aria-label="Hypothetical scenario">
          {lib.scenarios.map((s) => <button key={s.id} role="radio" aria-checked={s.id === activeId} className={`stress-scenario ${s.id === activeId ? 'is-active' : ''}`} onClick={() => { setScenarioId(s.id); setStockShock(''); setEtfShock(''); invalidate(); }} data-testid={`button-scenario-${s.id}`}>
            <strong>{s.name}</strong><small>{s.description}</small><span className="mono">Stock {s.stockShockPct}% · ETF {s.etfShockPct}%</span>
          </button>)}
        </div>
        <div className="stress-inputs">
          <label className="field"><span>Stock shock % (blank = {scenario?.stockShockPct}%)</span><input type="number" step="any" min={bounds?.min} max={bounds?.max} value={stockShock} placeholder={String(scenario?.stockShockPct ?? '')} onChange={(e) => edit(setStockShock)(e.target.value)} data-testid="input-stock-shock" /></label>
          <label className="field"><span>ETF shock % (blank = {scenario?.etfShockPct}%)</span><input type="number" step="any" min={bounds?.min} max={bounds?.max} value={etfShock} placeholder={String(scenario?.etfShockPct ?? '')} onChange={(e) => edit(setEtfShock)(e.target.value)} data-testid="input-etf-shock" /></label>
          <label className="field"><span>Reverse-stress target loss %</span><input type="number" step="any" value={target} onChange={(e) => edit(setTarget)(e.target.value)} data-testid="input-target-loss" /></label>
          <button className="button-primary risk-request-button" onClick={run} disabled={stress.isPending || !target.trim()} data-testid="button-run-stress">{stress.isPending ? <><LoaderCircle className="spin" size={15} /> Running…</> : <><Waves size={15} /> Run stress</>}</button>
        </div>
        <p className="stress-hint">Library bounds: {bounds?.min}% to {bounds?.max}%. Values outside bounds are clamped by the service and reported. Positive shocks make reverse stress unavailable. Simulation: {lib.simulation.pathCount} paths over {lib.simulation.horizonTradingDays} trading days, {lib.simulation.blockTradingDays}-day blocks, seed {lib.simulation.seed}.</p>
        {lib.notes.length > 0 && <Notes notes={lib.notes} title="Library notes" />}
      </div>}

    {stress.isPending && <div className="risk-loading" role="status" aria-live="polite"><span className="risk-loading-bars"><i /><i /><i /><i /></span><div><strong>Running stress and simulation</strong><p>Python is applying the scenario and generating simulated paths.</p></div></div>}
    {error && <div className="risk-error" role="alert"><AlertCircle size={17} /><div><strong>Stress analysis could not be completed</strong><p>{error}</p></div><button onClick={run} disabled={stress.isPending} data-testid="button-retry-stress">Try again <RotateCw size={13} /></button></div>}
    {result && <>
      <div className="risk-result-title"><div><Check size={15} /><span>STRESS RETURNED</span></div></div>
      <Report r={result} />
    </>}
  </section>;
}
