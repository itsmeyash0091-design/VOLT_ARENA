import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Ban, BrainCircuit, GitCompareArrows, History, Info, LoaderCircle, Lock, LogOut, Play, Scissors } from 'lucide-react';
import { useAnalyzePortfolioResilience, useGetGameSettings } from '@workspace/api-client-react';
import type { PortfolioHolding, ReflectionOptionId, ResilienceInput, ResilienceReport } from '@workspace/api-client-react';
import './simulator.css';

const guide = [
  { tone: 'pri', title: 'CONCEPT: LOSS AVERSION', text: 'Losses often feel heavier than gains of the same size. During a sharp fall that feeling can push people toward decisions they have not thought through.' },
  { tone: 'sec', title: 'CONCEPT: NAME YOUR LIMIT FIRST', text: 'This rehearsal asks you to state a rupee loss limit before anything is revealed. The analysis service then checks it against hidden simulated scenarios built from available price history.' },
  { tone: 'pri', title: 'CONCEPT: REFLECT, DO NOT PREDICT', text: 'The revealed outcome describes simulated scenarios only. It is not a forecast, not a recommendation and not a test of right or wrong choices.' },
];
const reflectionTone: Record<ReflectionOptionId, string> = { pause: 'sec', coverage: 'pri', assumptions: 'err' };

const inr = (v: number | null | undefined) => v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') return e.message;
  return 'The analysis service could not complete this rehearsal.';
}

export function Simulator({ holdings, inspectionKey, onResult }: { holdings: PortfolioHolding[]; inspectionKey?: string; onResult?: (r: ResilienceReport | undefined) => void }) {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const settings = useGetGameSettings();
  const run = useAnalyzePortfolioResilience();
  const req = useRef(0);
  const [step, setStep] = useState(0);
  const [limit, setLimit] = useState('');
  const [reflection, setReflection] = useState<ReflectionOptionId>();
  const [report, setReport] = useState<ResilienceReport>();
  const [error, setError] = useState('');
  const locked = !inspectionKey || !holdings.length;
  const s = settings.data;
  const pg = report?.panicGame;

  const clear = () => { req.current++; setReport(undefined); setError(''); onResultRef.current?.(undefined); };
  const reveal = () => {
    if (locked || run.isPending || !limit.trim()) return;
    const data: ResilienceInput = { holdings, lossLimitInr: limit.trim() };
    if (reflection) data.reflection = reflection;
    const id = ++req.current;
    setReport(undefined); setError(''); onResultRef.current?.(undefined);
    run.mutate({ data }, {
      onSuccess: (r) => { if (id === req.current) { setReport(r); onResultRef.current?.(r); } },
      onError: (e) => { if (id === req.current) setError(errText(e)); },
    });
  };

  const status = run.isPending ? 'RUNNING' : locked ? 'AWAITING INSPECTION' : pg ? pg.status.toUpperCase() : 'READY';
  const g = guide[step];

  return <div className="sm">
    <header className="sm-card sm-head">
      <div className="sm-head-glow" aria-hidden="true" />
      <div className="sm-head-l">
        <div className="sm-tags"><span className="sm-tag">SIMULATION 04</span><span className="sm-label sm-sec">BEHAVIORAL STRESS LAB</span></div>
        <h1 className="sm-h-lg">Turbulence &amp; Panic Dynamics</h1>
        <p className="sm-body sm-mute">A fictional 2090 rehearsal. Name a loss limit, then see how it compares with {s ? s.hiddenScenarioCount : 'the'} hidden simulated scenarios from the analysis service. No real orders, no predictions.</p>
      </div>
      <div className="sm-head-r">
        <div className="sm-stat"><div className="sm-label sm-mute">PORTFOLIO VALUE</div><div className="sm-h-sm sm-pri">{inr(report?.portfolioValueInr)}</div></div>
        <div className="sm-stat"><div className="sm-label sm-mute">STATUS</div><div className="sm-h-sm sm-sec" data-testid="text-sim-status">{status}</div></div>
      </div>
    </header>

    <div className="sm-grid">
      <div className="sm-left">
        <section className="sm-card sm-xl sm-guide">
          <div>
            <div className="sm-row sm-mb">
              <div className="sm-title"><BrainCircuit size={24} className="sm-pri" /><span className="sm-h-sm">Investment Guide // Market Insights</span></div>
              <span className="sm-pill sm-sec">STEP {step + 1}/{guide.length}</span>
            </div>
            <div className="sm-guide-body" key={step}>
              <div className={`sm-lbl-md sm-${g.tone}`}>{g.title}</div>
              <p className="sm-body-lg">{g.text}</p>
            </div>
          </div>
          <div className="sm-guide-foot">
            <button type="button" className="sm-btn-q" onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0} data-testid="button-guide-prev"><ArrowLeft size={16} /> PREV</button>
            <div className="sm-dots">{guide.map((_, i) => <button type="button" key={i} aria-label={`Step ${i + 1}`} className={i === step ? 'is-on' : ''} onClick={() => setStep(i)} data-testid={`button-guide-dot-${i}`} />)}</div>
            <button type="button" className="sm-btn-p" onClick={() => setStep((n) => Math.min(guide.length - 1, n + 1))} disabled={step === guide.length - 1} data-testid="button-guide-next">NEXT <ArrowRight size={16} /></button>
          </div>
        </section>
        <section className="sm-card sm-asset">
          <div><div className="sm-label sm-mute">SIMULATED ASSET</div><div className="sm-h-sm">YOUR INSPECTED HOLDINGS // {holdings.length || '—'}</div></div>
          <div className="sm-right"><div className="sm-label sm-err">HISTORY USED</div><div className="sm-h-sm sm-err">{report ? report.historyKind.toUpperCase() : '—'}</div></div>
        </section>
      </div>

      <section className="sm-card sm-xl sm-event">
        <div>
          <div className="sm-row sm-mb-s">
            <div className="sm-title"><History size={24} className="sm-sec" /><span className="sm-h-sm">Market Event: Hidden Scenario Rehearsal</span></div>
            <span className="sm-pill sm-pri">{run.isPending ? 'RUNNING' : pg ? `GAME ${pg.status.toUpperCase()}` : 'NOT STARTED'}</span>
          </div>
          <p className="sm-body sm-mute sm-mb">Set the largest rupee loss you would accept on this portfolio. The service evaluates {s ? `${s.hiddenScenarioCount} hidden scenarios over ${s.horizonTradingDays} trading days at ${s.confidencePct}% confidence` : 'its hidden scenarios'} and reveals how many stayed within your limit.</p>
          <div className="sm-panel">
            {locked ? <div className="sm-empty">Confirm and inspect your holdings on Portfolio first. Nothing runs before that.</div>
              : run.isPending ? <div className="sm-empty"><LoaderCircle className="sm-spin" size={20} /> Evaluating hidden scenarios…</div>
              : error ? <div className="sm-empty sm-err" role="alert">{error} <button type="button" className="sm-link" onClick={reveal} data-testid="button-retry-sim">Try again</button><button type="button" className="sm-link" onClick={clear}>Edit loss limit</button></div>
              : pg ? <div className="sm-reveal" data-testid="panel-reveal">
                <div className="sm-label sm-mute">REVEALED OUTCOME // {pg.status.toUpperCase()}</div>
                <p className="sm-body-lg">{pg.revealedOutcome ?? pg.message}</p>
                {pg.revealedOutcome && <p className="sm-body sm-mute">{pg.message}</p>}
                {pg.reflectionFeedback && <p className="sm-body sm-sec">{pg.reflectionFeedback}</p>}
              </div>
              : <div className="sm-form">
                <label><span className="sm-label sm-mute">LOSS LIMIT (₹)</span><input value={limit} onChange={(e) => { setLimit(e.target.value); clear(); }} inputMode="decimal" placeholder="e.g. 5000" data-testid="input-loss-limit" /></label>
                <button type="button" className="sm-btn-p" onClick={reveal} disabled={!limit.trim()} data-testid="button-reveal"><Play size={16} /> RUN &amp; REVEAL</button>
              </div>}
            {pg && !run.isPending && <button type="button" className="sm-link sm-again" onClick={clear} data-testid="button-sim-reset">Change limit or reflection</button>}
          </div>
        </div>

        <div className="sm-choices">
          <div className="sm-label sm-mute">CHOOSE YOUR REFLECTION (OPTIONAL, BEFORE REVEAL):</div>
          <div className="sm-choice-grid">
            {settings.isLoading && <div className="sm-empty">Loading reflections…</div>}
            {settings.isError && <div className="sm-empty sm-err">Game settings unavailable. <button type="button" className="sm-link" onClick={() => settings.refetch()}>Retry</button></div>}
            {s?.reflections.map((r) => <button type="button" key={r.id} className={`sm-choice ${reflectionTone[r.id]} ${reflection === r.id ? 'is-sel' : ''}`} aria-pressed={reflection === r.id} disabled={locked || run.isPending}
              onClick={() => { setReflection((c) => c === r.id ? undefined : r.id); clear(); }} data-testid={`button-reflection-${r.id}`}>
              <div className={`sm-lbl-md sm-${reflectionTone[r.id]}`}>{r.label.toUpperCase()}</div>
              <div className="sm-small sm-mute">Feedback shown after reveal.</div>
            </button>)}
          </div>
          <div className="sm-tactical" aria-label="Tactical actions unavailable">
            <span className="sm-x"><Lock size={14} /> HOLD</span><span className="sm-x"><Scissors size={14} /> SELL 25%</span><span className="sm-x"><LogOut size={14} /> SELL ALL</span>
            <p className="sm-small sm-mute"><Ban size={12} /> Tactical hold/sell actions are not computed by the analysis service, so they are disabled here.</p>
          </div>
        </div>
      </section>
    </div>

    <section className="sm-card sm-xl">
      <div className="sm-row sm-mb sm-wrap">
        <div>
          <div className="sm-title"><GitCompareArrows size={24} className="sm-sec" /><span className="sm-h-sm">Comparative Benchmark // Rehearsal Scope</span></div>
          <p className="sm-body sm-mute">Buy-and-hold vs tactical 5-year paths are not computed by the analysis service. Below are the actual rehearsal metrics.</p>
        </div>
        <span className="sm-pill sm-mute">STATUS: {pg ? pg.status.toUpperCase() : 'AWAITING REVEAL'}</span>
      </div>
      <div className="sm-cmp">
        <div className="sm-cmp-plot">
          <div className="sm-empty"><Ban size={18} /> Path comparison unavailable: no event path, buy-and-hold benchmark or 5-year projection exists in the API.</div>
        </div>
        <div className="sm-metrics">
          <div className="sm-metric"><div className="sm-label sm-mute">SCENARIOS WITHIN YOUR LIMIT</div><div className="sm-h-md sm-sec" data-testid="text-within">{pg && pg.withinLimitCount !== null ? `${pg.withinLimitCount} / ${pg.evaluatedScenarioCount}` : '—'}</div></div>
          <div className="sm-metric"><div className="sm-label sm-mute">REHEARSAL COVERAGE SCORE</div><div className="sm-h-md sm-pri" data-testid="text-coverage-score">{pg?.coverageScorePct != null ? `${pg.coverageScorePct}%` : '—'}</div></div>
          <div className="sm-metric"><div className="sm-label sm-mute">LOSS LIMIT EVALUATED</div><div className="sm-body">{inr(pg?.lossLimitInr)}</div><p className="sm-small sm-mute">Coverage is the share of simulated scenarios within this limit, not a return or a skill grade.</p></div>
        </div>
      </div>
      {report && <div className="sm-kv">
        <div><span>Source / as of</span><b>{report.source} (prototype) / {report.valuationDate ?? '—'}</b></div>
        <div><span>Coverage</span><b>{report.coverageStatus} · {report.coverageStart ?? '—'} – {report.coverageEnd ?? '—'}</b></div>
        <div><span>Valid returns / excluded</span><b>{report.validReturnCount} / {report.excludedIntervalCount}</b></div>
        <div><span>Checked</span><b>{report.checkedAt}</b></div>
      </div>}
      {report && report.instruments.length > 0 && <div className="sm-chips">{report.instruments.map((i) => <span key={i.ticker} className={`sm-chip ${i.dataType}`}>{i.ticker}: {i.dataType === 'observed' ? 'Observed' : i.dataType === 'proxy' ? `Proxy${i.proxyInstrument ? ` (${i.proxyInstrument})` : ''}` : 'Insufficient'}</span>)}</div>}
      {report && report.instruments.length > 0 && <details className="sm-note"><summary>History details per holding</summary>{report.instruments.map((i) => <p className="sm-note" key={`${i.ticker}:${i.sourceSymbol}`}>{i.ticker}: {i.dataType}; source {i.sourceSymbol ?? 'not reported'}{i.proxyInstrument ? `; proxy ${i.proxyInstrument}` : ''}; coverage {i.coverageStart ?? 'not reported'} – {i.coverageEnd ?? 'not reported'}. {i.note}</p>)}</details>}
      {report?.notes.map((n, k) => <p key={k} className="sm-note">{n}</p>)}
    </section>

    <div className="sm-disc"><Info size={20} /><p className="sm-small sm-mute"><b>DISCLAIMER:</b> Fictional 2090 setting. No real orders, no real-time trading, no financial advice, no predictions. Scenarios are simulated from observed or proxy price history (Yahoo Finance prototype source, may be incomplete) and computed by the analysis service.</p></div>
  </div>;
}
