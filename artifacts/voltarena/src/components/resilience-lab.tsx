import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Copy, Gauge, Info, LoaderCircle, RotateCw, ShieldCheck, Target } from 'lucide-react';
import { useAnalyzePortfolioResilience, useGetGameSettings } from '@workspace/api-client-react';
import type {
  CrashCard, GameSettings, PanicGameResult, PortfolioHolding, PortfolioLevels,
  ResilienceInput, ResilienceInputReflection, ResilienceReport, RiskInstrumentCoverage,
} from '@workspace/api-client-react';

function errText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The resilience request could not be completed. Please try again.';
}
const num = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? 'Not available' : `${v.toLocaleString('en-IN', { maximumFractionDigits: 8 })}${suffix}`);
const inr = (v: number | null | undefined) => (v === null || v === undefined ? 'Not available' : `INR ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

function Tag({ value }: { value: string }) {
  return <span className={`risk-status risk-status-${value.replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>;
}
function M({ label, value, id }: { label: string; value: string; id?: string }) {
  return <div className="risk-metric" data-testid={id}><span>{label}</span><b>{value}</b></div>;
}
function Notes({ notes, title }: { notes: string[]; title: string }) {
  return <section className="risk-notes"><div className="risk-subheading"><Info size={14} /><strong>{title}</strong></div>
    {notes.length ? <ul>{notes.map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}</ul> : <p>No notes were returned.</p>}</section>;
}
function Coverage({ items }: { items: RiskInstrumentCoverage[] }) {
  return <section className="risk-coverage"><div className="risk-subheading"><ShieldCheck size={14} /><strong>History &amp; provenance</strong><span>{items.length}</span></div>
    {items.length ? <div className="risk-coverage-grid">{items.map((item, i) => <div key={`${item.ticker}-${i}`} className={`risk-provenance risk-provenance-${item.dataType}`}>
      <span className="risk-provenance-label">{item.dataType === 'observed' ? 'Observed history' : item.dataType === 'proxy' ? 'Proxy history' : 'Insufficient history'}</span>
      <strong>{item.ticker} <small>{item.instrumentType.toUpperCase()}</small></strong>
      <span className="risk-provenance-source">{item.sourceSymbol ? `Source: ${item.sourceSymbol}` : 'Source symbol not reported'}{item.proxyInstrument ? ` · Proxy: ${item.proxyInstrument}` : ''}</span>
      <span className="risk-provenance-dates">{item.coverageStart && item.coverageEnd ? `${item.coverageStart} — ${item.coverageEnd}` : 'Coverage dates not reported'} · {item.observationCount} observations · {item.missingAlignedObservations} missing aligned</span>
      <p>{item.note}</p></div>)}</div> : <p className="risk-no-data">No per-instrument coverage was returned.</p>}
  </section>;
}

function SettingsPanel({ s, title }: { s: GameSettings; title: string }) {
  return <section className="risk-contribution res-settings" data-testid="section-game-settings">
    <div className="risk-section-intro"><div><div className="risk-kicker">{title}</div><h3>The rules, stated up front.</h3></div><span className="res-version mono">{s.scoringVersion}</span></div>
    <div className="risk-contribution-summary">
      <M label="CVaR confidence" value={`${s.confidencePct}%`} />
      <M label="CVaR horizon (trading days)" value={String(s.horizonTradingDays)} />
      <M label="Confidence bounds" value={`${s.confidenceBoundsPct.min}% to ${s.confidenceBoundsPct.max}%`} />
      <M label="Horizon bounds (days)" value={`${s.horizonBoundsDays.min} to ${s.horizonBoundsDays.max}`} />
      <M label="Hidden scenarios (fixed)" value={String(s.hiddenScenarioCount)} />
      <M label="Hidden seed" value={String(s.hiddenSeed)} />
      <M label="Component share tolerance" value={String(s.componentShareTolerance)} />
      <M label="Benchmark method" value={s.benchmarkMethod} />
    </div>
    {s.levels.length > 0 && <div className="res-ladder" aria-label="Level thresholds">{s.levels.map((l) => <div key={l.level} className="res-rung"><b className="mono">L{l.level}</b><span>{l.label}</span><small className="mono">{l.maxRatio === null ? 'no upper ratio' : `ratio up to ${l.maxRatio}`}</small></div>)}</div>}
    <Notes notes={s.assumptions} title="Stated assumptions" />
  </section>;
}

function Levels({ lv }: { lv: PortfolioLevels }) {
  return <section className="risk-contribution" data-testid="section-levels">
    <div className="risk-section-intro"><div><div className="risk-kicker">01 / LEVELS · TAIL-LOSS BALANCE</div><h3>{lv.status === 'available' ? lv.label : 'Levels unavailable.'}</h3></div><Tag value={lv.status} /></div>
    {lv.status === 'unavailable' ? <div className="res-unavailable" role="note" data-testid="text-levels-reason"><AlertCircle size={15} /><div><strong>No level, no fallback score</strong><p>{lv.reason}</p></div></div> : <>
      <div className="res-level-hero">
        <div className="res-level-num"><span>LEVEL</span><b className="mono" data-testid="text-level">{num(lv.level)}</b></div>
        <div className="res-level-score"><span>SCORE</span><b className="mono" data-testid="text-score">{num(lv.scorePct, '%')}</b></div>
        <p>{lv.reason}</p>
      </div>
      <div className="risk-contribution-summary">
        <M label="Current CVaR" value={`${inr(lv.currentCvarInr)} · ${num(lv.currentCvarPct, '%')}`} />
        <M label="Equal-component benchmark CVaR" value={`${inr(lv.parCvarInr)} · ${num(lv.parCvarPct, '%')}`} />
        <M label="Ratio to benchmark" value={num(lv.ratioToPar)} />
        <M label="Max component share error" value={num(lv.maxComponentShareErrorPct, '%')} />
      </div>
      {lv.holdings.length ? <div className="risk-table-scroll"><table className="risk-table" data-testid="table-par-holdings">
        <thead><tr><th>Instrument</th><th>Current weight</th><th>Benchmark weight</th><th>Benchmark component CVaR</th><th>Benchmark share</th></tr></thead>
        <tbody>{lv.holdings.map((h, i) => <tr key={`${h.ticker}-${i}`}><td><strong>{h.ticker}</strong><small className="risk-instrument-type">{h.exchange}</small></td><td className="mono">{h.currentWeightPct}%</td><td className="mono">{h.parWeightPct}%</td><td className="mono">{inr(h.parComponentCvarInr)}</td><td className="mono">{h.parComponentSharePct}%</td></tr>)}</tbody>
      </table></div> : <div className="risk-no-data">No per-holding benchmark rows were returned.</div>}
    </>}
    <p className="res-disclose"><Info size={13} /> Benchmark weights equalise each holding's share of tail loss: long-only, fully invested, no leverage, current holdings only. They are an analytical comparison, not an allocation recommendation.</p>
  </section>;
}

function Panic({ g, reflections, choice, onReflect, pending }: { g: PanicGameResult; reflections: GameSettings['reflections']; choice: ResilienceInputReflection | ''; onReflect: (r: ResilienceInputReflection) => void; pending: boolean }) {
  return <section className="risk-contribution res-panic" data-testid="section-panic-game">
    <div className="risk-section-intro"><div><div className="risk-kicker">02 / PANIC REHEARSAL · NON-TRADING</div><h3>{g.status === 'revealed' ? 'The draw is revealed.' : g.status === 'ready' ? 'Name a loss limit first.' : 'Rehearsal unavailable.'}</h3></div><Tag value={g.status} /></div>
    {g.status === 'unavailable' ? <div className="res-unavailable" role="note"><AlertCircle size={15} /><div><strong>No rehearsal for this portfolio</strong><p data-testid="text-panic-message">{g.message}</p></div></div>
      : g.status === 'ready' ? <div className="res-ready" data-testid="text-panic-message"><Target size={16} /><p>{g.message}</p></div>
      : <>
        <div className="res-reveal">
          <div className="res-reveal-outcome"><span>SAMPLED ADVERSE OUTCOME</span><p data-testid="text-revealed-outcome">{g.revealedOutcome ?? 'Not returned'}</p></div>
          <div className="res-reveal-stats">
            <M label="Declared limit" value={inr(g.lossLimitInr)} id="text-loss-limit" />
            <M label="Within limit" value={`${num(g.withinLimitCount)} of ${g.evaluatedScenarioCount}`} id="text-within-count" />
            <M label="Budget coverage" value={num(g.coverageScorePct, '%')} id="text-coverage" />
          </div>
        </div>
        <p className="res-message">{g.message}</p>
      </>}
    {g.status !== 'unavailable' && <p className="res-disclose"><Info size={13} /> Budget coverage is not a skill grade and is unrelated to Levels. A larger limit mechanically covers more of the hidden losses. Nothing here is a trade.</p>}
    {g.status === 'revealed' && reflections.length > 0 && <div className="res-reflect">
      <div className="risk-subheading"><strong>What would you do with this?</strong></div>
      <div className="res-reflect-options" role="radiogroup" aria-label="Reflection">{reflections.map((r) => <button key={r.id} role="radio" aria-checked={choice === r.id} className={`res-reflect-btn ${choice === r.id ? 'is-active' : ''}`} disabled={pending} onClick={() => onReflect(r.id)} data-testid={`button-reflect-${r.id}`}>{r.label}</button>)}</div>
      {g.reflectionFeedback && <p className="res-feedback" data-testid="text-reflection-feedback">{g.reflectionFeedback}</p>}
    </div>}
  </section>;
}

function Card({ c }: { c: CrashCard }) {
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(c.text);
      setCopied('Copied');
    } catch {
      setCopied('Copy unavailable');
    }
  };
  const structured = c.header || c.findings.length || c.footer;
  return <section className="risk-contribution" data-testid="section-crash-card">
    <div className="risk-section-intro"><div><div className="risk-kicker">03 / CRASH CARD</div><h3>One card, Python's words.</h3></div><span className="res-version mono">{c.templateVersion}</span></div>
    <article className="res-card" data-testid="card-crash">
      {structured ? <>
        {c.header && <h4>{c.header}</h4>}
        {c.findings.length > 0 && <ol>{c.findings.map((f, i) => <li key={i}>{f}</li>)}</ol>}
        {c.footer && <footer>{c.footer}</footer>}
      </> : <p className="res-card-text">{c.text}</p>}
    </article>
    <div className="res-card-meta"><span className="mono" data-testid="text-word-count">{c.wordCount} words returned</span>{c.text && <button className="button-outline" onClick={copy} data-testid="button-copy-card"><Copy size={13} /> {copied || 'Copy text'}</button>}</div>
  </section>;
}

function Report({ r, choice, onReflect, pending }: { r: ResilienceReport; choice: ResilienceInputReflection | ''; onReflect: (x: ResilienceInputReflection) => void; pending: boolean }) {
  return <div className="risk-report" data-testid="resilience-report">
    <div className="risk-report-meta">
      <div><span>SOURCE</span><b>{r.source}</b></div>
      <div><span>VALUATION DATE</span><b>{r.valuationDate ?? 'Not available'}</b></div>
      <div><span>PORTFOLIO VALUE</span><b>{inr(r.portfolioValueInr)}</b></div>
      <div><span>CHECKED AT</span><b>{r.checkedAt}</b></div>
    </div>
    <div className="risk-contribution-summary res-runline">
      <M label="Confidence used" value={`${r.settings.confidencePct}%`} />
      <M label="Horizon used (trading days)" value={String(r.settings.horizonTradingDays)} />
      <M label="Evaluated scenarios" value={String(r.evaluatedScenarioCount)} id="text-evaluated-count" />
      <M label="Seed" value={String(r.settings.hiddenSeed)} />
      <M label="Hidden scenario digest" value={r.hiddenScenarioDigest ?? 'Not available'} />
      <M label="History kind" value={r.historyKind} />
      <M label="Coverage status" value={r.coverageStatus} />
      <M label="Source coverage" value={r.coverageStart && r.coverageEnd ? `${r.coverageStart} — ${r.coverageEnd}` : 'Not reported'} />
      <M label="Valid returns / excluded intervals" value={`${r.validReturnCount} / ${r.excludedIntervalCount}`} />
    </div>
    {(r.historyKind !== 'observed' || r.coverageStatus !== 'complete') && <div className="stress-notice" role="note"><AlertCircle size={15} /><div><strong>{r.historyKind === 'proxy' || r.historyKind === 'mixed' ? 'Includes proxy history' : 'History is limited'}</strong><p>History kind: {r.historyKind}. Coverage: {r.coverageStatus}.</p></div></div>}
    <Levels lv={r.levels} />
    <Panic g={r.panicGame} reflections={r.settings.reflections} choice={choice} onReflect={onReflect} pending={pending} />
    <Card c={r.crashCard} />
    <Coverage items={r.instruments} />
    <SettingsPanel s={r.settings} title="SETTINGS RETURNED WITH THIS RUN" />
    <Notes notes={r.notes} title="Method notes" />
    <p className="risk-disclaimer"><Info size={14} /> Every figure is returned by the Python service. Simulated losses are neither observed history nor forecasts. Nothing here is a recommendation to trade or reallocate.</p>
  </div>;
}

export function ResilienceLab({ holdings }: { holdings: PortfolioHolding[] }) {
  const settings = useGetGameSettings();
  const resilience = useAnalyzePortfolioResilience();
  const [confidence, setConfidence] = useState('');
  const [horizon, setHorizon] = useState('');
  const [limit, setLimit] = useState('');
  const [reflection, setReflection] = useState<ResilienceInputReflection | ''>('');
  const [result, setResult] = useState<ResilienceReport>();
  const [error, setError] = useState('');
  const reqId = useRef(0);
  const holdingsKey = JSON.stringify(holdings);

  const invalidate = () => { reqId.current++; setResult(undefined); setError(''); setReflection(''); resilience.reset(); };
  const resetRef = useRef(invalidate); resetRef.current = invalidate;
  useEffect(() => { resetRef.current(); }, [holdingsKey]);

  const submit = (choice: ResilienceInputReflection | '', keepResult: boolean) => {
    if (!holdings.length) return;
    const data: ResilienceInput = { holdings };
    if (confidence.trim()) data.confidencePct = confidence.trim();
    if (horizon.trim()) data.horizonTradingDays = horizon.trim();
    if (limit.trim()) data.lossLimitInr = limit.trim();
    if (choice) data.reflection = choice;
    const id = ++reqId.current;
    if (!keepResult) setResult(undefined);
    setError('');
    resilience.mutate({ data }, {
      onSuccess: (r) => { if (id === reqId.current) setResult(r); },
      onError: (e) => { if (id === reqId.current) setError(errText(e)); },
    });
  };
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); invalidate(); };
  const reflect = (choice: ResilienceInputReflection) => { setReflection(choice); submit(choice, true); };
  const s = settings.data;

  return <section className="risk-analysis-section res-section enter" id="resilience-lab" aria-busy={resilience.isPending} data-testid="section-resilience-lab">
    <div className="risk-analysis-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule" /> STAGE 04 / LEVELS, REHEARSAL &amp; CRASH CARD</div>
        <h2>Explore risk, <em>on paper.</em></h2>
        <p>Compare how evenly tail loss is spread, declare a rupee loss you could sit through, then reveal one of {s ? s.hiddenScenarioCount : 'the fixed set of'} hidden simulated losses. A rehearsal, never a trade.</p>
      </div>
      <span className="risk-session-mark"><ShieldCheck size={14} /> SESSION ONLY</span>
    </div>

    {settings.isLoading ? <div className="risk-loading" role="status"><span className="risk-loading-bars"><i /><i /><i /><i /></span><div><strong>Loading rehearsal settings</strong><p>Fetching scoring rules and assumptions.</p></div></div>
      : settings.isError || !s ? <div className="risk-error" role="alert"><AlertCircle size={17} /><div><strong>Rehearsal settings could not be loaded</strong><p>{errText(settings.error)}</p></div><button onClick={() => { void settings.refetch(); }} data-testid="button-retry-settings">Try again <RotateCw size={13} /></button></div>
      : <div className="stress-form">
        <div className="stress-inputs res-inputs">
          <label className="field"><span>Confidence % (blank = {s.confidencePct})</span><input type="number" step="any" min={s.confidenceBoundsPct.min} max={s.confidenceBoundsPct.max} value={confidence} placeholder={String(s.confidencePct)} onChange={(e) => edit(setConfidence)(e.target.value)} data-testid="input-confidence" /></label>
          <label className="field"><span>Horizon, trading days (blank = {s.horizonTradingDays})</span><input type="number" step="1" min={s.horizonBoundsDays.min} max={s.horizonBoundsDays.max} value={horizon} placeholder={String(s.horizonTradingDays)} onChange={(e) => edit(setHorizon)(e.target.value)} data-testid="input-horizon" /></label>
          <label className="field"><span>Hypothetical loss limit, INR (optional)</span><input type="number" step="any" min={0} value={limit} placeholder="Leave blank to set later" onChange={(e) => edit(setLimit)(e.target.value)} data-testid="input-loss-limit" /></label>
          <button className="button-primary risk-request-button" onClick={() => submit(reflection, false)} disabled={resilience.isPending} data-testid="button-run-resilience">{resilience.isPending ? <><LoaderCircle className="spin" size={15} /> Running…</> : <><Gauge size={15} /> {limit.trim() ? 'Run rehearsal' : 'Check levels'}</>}</button>
        </div>
        <p className="stress-hint">Exactly {s.hiddenScenarioCount} hidden simulated losses, seed {s.hiddenSeed}. Loss vectors stay on the server; only the returned summary reaches this page. Zero is an allowed limit.</p>
        {!result && <SettingsPanel s={s} title="CURRENT SETTINGS" />}
      </div>}

    {resilience.isPending && <div className="risk-loading" role="status" aria-live="polite"><span className="risk-loading-bars"><i /><i /><i /><i /></span><div><strong>Evaluating hidden scenarios</strong><p>Python is computing levels, the rehearsal and the crash card.</p></div></div>}
    {error && <div className="risk-error" role="alert"><AlertCircle size={17} /><div><strong>Resilience analysis could not be completed</strong><p>{error}</p></div><button onClick={() => submit(reflection, false)} disabled={resilience.isPending} data-testid="button-retry-resilience">Try again <RotateCw size={13} /></button></div>}
    {result && <Report r={result} choice={reflection} onReflect={reflect} pending={resilience.isPending} />}
  </section>;
}
