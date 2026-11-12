import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BrainCircuit, Download, GitCompareArrows, History, Info, LoaderCircle, Lock, LogOut, Play, RotateCcw, Scissors } from 'lucide-react';
import { useAnalyzePortfolioResilience, useGetGameSettings } from '@workspace/api-client-react';
import type { PortfolioHolding, PortfolioInspectReport, ReflectionOptionId, ResilienceInput, ResilienceReport, SimulatedExposureChoiceId } from '@workspace/api-client-react';
import { checkNumber, csvLine, gainLabel, inr, lossLabel } from './simulator-helpers';
import './simulator.css';

const guide = [
  { tone: 'pri', title: 'CONCEPT: LOSS AVERSION', text: 'Losses often feel heavier than gains of the same size. During a sharp fall that feeling can push people toward decisions they have not thought through.' },
  { tone: 'sec', title: 'CONCEPT: NAME YOUR LIMIT FIRST', text: 'This rehearsal asks you to state a rupee loss limit before anything is revealed. The analysis service then checks it against hidden simulated scenarios built from available price history.' },
  { tone: 'pri', title: 'CONCEPT: REFLECT, DO NOT PREDICT', text: 'The revealed outcome describes simulated scenarios only. It is not a forecast, not a recommendation and not a test of right or wrong choices.' },
];
const reflectionTone: Record<ReflectionOptionId, string> = { pause: 'sec', coverage: 'pri', assumptions: 'err' };
const choiceMeta: Record<SimulatedExposureChoiceId, { tone: string; icon: typeof Lock }> = { hold: { tone: 'sec', icon: Lock }, trim: { tone: 'pri', icon: Scissors }, exit: { tone: 'err', icon: LogOut } };

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') return e.message;
  return 'The analysis service could not complete this rehearsal.';
}
function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Snapshot = PortfolioInspectReport['valuation'];

export function Simulator({ holdings, inspectionKey, onResult, snapshot }: { holdings: PortfolioHolding[]; inspectionKey?: string; onResult?: (r: ResilienceReport | undefined) => void; snapshot?: Snapshot }) {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const settings = useGetGameSettings();
  const run = useAnalyzePortfolioResilience();
  const req = useRef(0);
  useEffect(() => () => { req.current++; }, []);
  const [step, setStep] = useState(0);
  const [limit, setLimit] = useState('');
  const [conf, setConf] = useState('');
  const [horizon, setHorizon] = useState('');
  const [reflection, setReflection] = useState<ReflectionOptionId>();
  const [report, setReport] = useState<ResilienceReport>();
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [choice, setChoice] = useState<SimulatedExposureChoiceId>('hold');
  const locked = !inspectionKey || !holdings.length;
  const s = settings.data;
  const pg = report?.panicGame;
  const sc = report?.simulatedChoices;
  const L = report?.levels;

  const checks = {
    limit: checkNumber(limit, { label: 'Loss limit', min: 0, required: true }),
    conf: s ? checkNumber(conf, { label: 'Confidence', min: s.confidenceBoundsPct.min, max: s.confidenceBoundsPct.max }) : null,
    horizon: s ? checkNumber(horizon, { label: 'Horizon', min: s.horizonBoundsDays.min, max: s.horizonBoundsDays.max, integer: true }) : null,
  };
  const invalid = Object.values(checks).filter((c) => c && !c.ok).map((c) => (c as { message: string }).message);

  // Any input edit: invalidate in-flight, mark the shown result stale, clear the shared result.
  const edited = () => { req.current++; if (report) setStale(true); setError(''); onResultRef.current?.(undefined); };
  const reset = () => { req.current++; setReport(undefined); setStale(false); setError(''); setTried(false); setLimit(''); setConf(''); setHorizon(''); setReflection(undefined); setChoice('hold'); onResultRef.current?.(undefined); };
  const reveal = () => {
    setTried(true);
    if (locked || run.isPending || !s || settings.isError || invalid.length || !checks.limit?.ok) return;
    const data: ResilienceInput = { holdings, lossLimitInr: checks.limit.value };
    if (checks.conf?.ok) data.confidencePct = checks.conf.value;
    if (checks.horizon?.ok) data.horizonTradingDays = checks.horizon.value;
    if (reflection) data.reflection = reflection;
    const id = ++req.current;
    setError(''); if (report) setStale(true); onResultRef.current?.(undefined);
    run.mutate({ data }, {
      onSuccess: (r) => { if (id === req.current) { setReport(r); setStale(false); onResultRef.current?.(r); } },
      onError: (e) => { if (id === req.current) setError(errText(e)); },
    });
  };

  const exportJson = () => { if (report) save(`rehearsal-${report.checkedAt}.json`, JSON.stringify({ scope: 'Simulated test of session holdings; no real trades or financial advice.', stale, report }, null, 2), 'application/json'); };
  const exportCsv = () => {
    if (!report) return;
    const c = report.simulatedChoices;
    const lines = [
      csvLine(['Scope', 'Simulated exposure comparison on the same hidden scenarios; not a recommendation; no trades']),
      csvLine(['Previous result / stale', stale]),
      csvLine(['Status', c.status]), csvLine(['Message', c.message]),
      csvLine(['Horizon trading days', c.horizonTradingDays]), csvLine(['Evaluated scenarios', c.evaluatedScenarioCount]),
      csvLine(['Confidence %', report.settings.confidencePct]), csvLine(['Loss limit INR', report.panicGame.lossLimitInr]),
      csvLine(['Seed', report.settings.hiddenSeed]), csvLine(['Scoring version', report.settings.scoringVersion]),
      csvLine(['Sampled input digest', report.hiddenScenarioDigest]),
      csvLine(['Start value INR (adjusted history)', report.portfolioValueInr]), csvLine(['Valuation date', report.valuationDate]),
      csvLine(['Source', `${report.source} (prototype)`]), csvLine(['Checked at', report.checkedAt]),
      csvLine(['History', report.historyKind]), csvLine(['Coverage', `${report.coverageStatus} ${report.coverageStart ?? ''} to ${report.coverageEnd ?? ''}`]),
      ...report.instruments.map((i) => csvLine(['Holding history', i.ticker, i.dataType, i.sourceSymbol, i.proxyInstrument, i.coverageStart, i.coverageEnd, i.note])),
      ...report.notes.map((n) => csvLine(['Source note', n])),
      ...c.assumptions.map((a) => csvLine(['Assumption', a])), '',
      csvLine(['Choice id', 'Label', 'Exposure %', 'Cash %', 'Market value INR', 'Cash value INR', 'Worst loss INR (negative = gain)', 'Best gain INR (negative = loss)', 'Tail loss INR', 'Median end value INR', 'Within limit count', 'Coverage score %']),
      ...c.choices.map((x) => csvLine([x.id, x.label, x.exposurePct, x.cashPct, x.marketValueInr, x.cashValueInr, x.worstLossInr, x.bestGainInr, x.tailLossInr, x.medianEndValueInr, x.withinLimitCount, x.coverageScorePct])),
    ];
    save(`rehearsal-choices-${report.checkedAt}.csv`, lines.join('\n'), 'text/csv');
  };

  const status = run.isPending ? 'RUNNING' : locked ? 'AWAITING INSPECTION' : error ? 'ERROR' : pg ? (stale ? 'STALE' : pg.status.toUpperCase()) : 'READY';
  const g = guide[step];
  const sel = sc?.choices.find((x) => x.id === choice);

  return <div className="sm">
    <header className="sm-card sm-head">
      <div className="sm-head-glow" aria-hidden="true" />
      <div className="sm-head-l">
        <div className="sm-tags"><span className="sm-tag">SIMULATION 04</span><span className="sm-label sm-sec">BEHAVIORAL STRESS LAB</span></div>
        <h1 className="sm-h-lg">Turbulence &amp; Panic Dynamics</h1>
        <p className="sm-body sm-mute">Set a loss limit and compare it with {s ? s.hiddenScenarioCount : 'the'} hidden simulated scenarios. No real trades or predictions.</p>
      </div>
      <div className="sm-head-r">
        <div className="sm-stat"><div className="sm-label sm-mute">START VALUE (ADJ. HISTORY)</div><div className="sm-h-sm sm-pri">{inr(report?.portfolioValueInr)}</div></div>
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
          <div><div className="sm-label sm-mute">SIMULATED ASSET</div><div className="sm-h-sm">YOUR INSPECTED HOLDINGS // {holdings.length || '—'}</div>
            <div className="sm-small sm-mute">Raw-close snapshot: {snapshot?.status === 'complete' ? `${inr(snapshot.totalValueInr)} on ${snapshot.asOfDate ?? '—'}` : snapshot ? `unavailable (${snapshot.reason ?? 'no reason returned'})` : 'not returned'}. Separate from the rehearsal start value.</div></div>
          <div className="sm-right"><div className="sm-label sm-err">HISTORY USED</div><div className="sm-h-sm sm-err">{report ? report.historyKind.toUpperCase() : '—'}</div></div>
        </section>
      </div>

      <section className="sm-card sm-xl sm-event">
        <div>
          <div className="sm-row sm-mb-s">
            <div className="sm-title"><History size={24} className="sm-sec" /><span className="sm-h-sm">Market Event: Hidden Scenario Rehearsal</span></div>
            <span className="sm-pill sm-pri">{run.isPending ? 'RUNNING' : pg ? `GAME ${pg.status.toUpperCase()}${stale ? ' · STALE' : ''}` : 'NOT STARTED'}</span>
          </div>
          <p className="sm-body sm-mute sm-mb">Set the largest rupee loss you would accept. The service evaluates {s ? `${s.hiddenScenarioCount} hidden scenarios (defaults: ${s.horizonTradingDays} trading days, ${s.confidencePct}% confidence)` : 'its hidden scenarios'} and reveals how many stayed within your limit.</p>
          <div className="sm-panel">
            {locked ? <div className="sm-empty">Confirm and inspect your holdings on Portfolio first. Nothing runs before that.</div> : <>
              <div className="sm-form">
                <label><span className="sm-label sm-mute">LOSS LIMIT (₹, 0 ALLOWED)</span><input value={limit} onChange={(e) => { setLimit(e.target.value); edited(); }} inputMode="decimal" placeholder="e.g. 5000" aria-invalid={tried && checks.limit?.ok === false} data-testid="input-loss-limit" /></label>
                <label><span className="sm-label sm-mute">CONFIDENCE % {s ? `(${s.confidenceBoundsPct.min}–${s.confidenceBoundsPct.max})` : ''}</span><input value={conf} onChange={(e) => { setConf(e.target.value); edited(); }} inputMode="decimal" placeholder={s ? `Default ${s.confidencePct}` : 'Settings needed'} disabled={!s} data-testid="input-confidence" /></label>
                <label><span className="sm-label sm-mute">HORIZON DAYS {s ? `(${s.horizonBoundsDays.min}–${s.horizonBoundsDays.max})` : ''}</span><input value={horizon} onChange={(e) => { setHorizon(e.target.value); edited(); }} inputMode="numeric" placeholder={s ? `Default ${s.horizonTradingDays}` : 'Settings needed'} disabled={!s} data-testid="input-horizon" /></label>
              </div>
              {(tried || invalid.some((m) => !m.endsWith('required.'))) && invalid.length > 0 && <div className="sm-small sm-err" role="alert">{invalid.join(' ')}</div>}
              {settings.isError && <div className="sm-small sm-err">Game settings unavailable, so nothing can run. <button type="button" className="sm-link" onClick={() => settings.refetch()} data-testid="button-retry-settings">Retry settings</button></div>}
              <div className="sm-actions">
                <button type="button" className="sm-btn-p" onClick={reveal} disabled={run.isPending || !s || settings.isError} data-testid="button-reveal">{run.isPending ? <LoaderCircle size={16} className="sm-spin" /> : <Play size={16} />} {report ? 'RERUN' : 'RUN & REVEAL'}</button>
                {(report || error) && <button type="button" className="sm-btn-q" onClick={reset} data-testid="button-sim-reset"><RotateCcw size={14} /> RESET</button>}
                <span className="sm-small sm-mute">Blank confidence or horizon uses the setting default shown.</span>
              </div>
              {run.isPending && <div className="sm-empty"><LoaderCircle className="sm-spin" size={20} /> Evaluating hidden scenarios…</div>}
              {error && !run.isPending && <div className="sm-empty sm-err">{error} Your inputs are kept; edit them or <button type="button" className="sm-link" onClick={reveal} data-testid="button-retry-sim">try again</button>.</div>}
              {pg && !run.isPending && <div className="sm-reveal" data-testid="panel-reveal">
                {stale && <div className="sm-small sm-err" role="status">Previous result — rerun to use current inputs and source data.</div>}
                <div className="sm-label sm-mute">REVEALED OUTCOME // {pg.status.toUpperCase()} · LIMIT {inr(pg.lossLimitInr)} · {report?.settings.confidencePct}% / {report?.settings.horizonTradingDays} DAYS</div>
                <p className="sm-body-lg">{pg.revealedOutcome ?? pg.message}</p>
                {pg.revealedOutcome && <p className="sm-body sm-mute">{pg.message}</p>}
                {pg.reflectionFeedback && <p className="sm-body sm-sec">{pg.reflectionFeedback}</p>}
              </div>}
            </>}
          </div>
        </div>

        <div className="sm-choices">
          <div className="sm-label sm-mute">CHOOSE YOUR REFLECTION (OPTIONAL, SENT WITH THE RUN):</div>
          <div className="sm-choice-grid">
            {settings.isLoading && <div className="sm-empty">Loading reflections…</div>}
            {settings.isError && <div className="sm-empty sm-err">Game settings unavailable. <button type="button" className="sm-link" onClick={() => settings.refetch()}>Retry</button></div>}
            {s?.reflections.map((r) => <button type="button" key={r.id} className={`sm-choice ${reflectionTone[r.id]} ${reflection === r.id ? 'is-sel' : ''}`} aria-pressed={reflection === r.id} disabled={locked || run.isPending}
              onClick={() => { setReflection((c) => c === r.id ? undefined : r.id); edited(); }} data-testid={`button-reflection-${r.id}`}>
              <div className={`sm-lbl-md sm-${reflectionTone[r.id]}`}>{r.label.toUpperCase()}</div>
              <div className="sm-small sm-mute">Feedback shown after reveal.</div>
            </button>)}
          </div>
          <div className="sm-label sm-mute">SIMULATED EXPOSURE CHOICES (VIEW ONLY, NO HOLDINGS CHANGE):</div>
          <div className="sm-choice-grid">
            {(['hold', 'trim', 'exit'] as SimulatedExposureChoiceId[]).map((id) => { const m = choiceMeta[id]; const I = m.icon; const x = sc?.choices.find((c) => c.id === id);
              return <button type="button" key={id} className={`sm-choice ${m.tone} ${choice === id && x ? 'is-sel' : ''}`} aria-pressed={choice === id} disabled={!x} onClick={() => setChoice(id)} data-testid={`button-choice-${id}`}>
                <div className={`sm-lbl-md sm-${m.tone} sm-row`}>{(x?.label ?? id).toUpperCase()} <I size={16} /></div>
                <div className="sm-small sm-mute">{x ? `${x.exposurePct}% market / ${x.cashPct}% cash` : 'Run the rehearsal to compare.'}</div>
              </button>; })}
          </div>
        </div>
      </section>
    </div>

    <section className="sm-card sm-xl">
      <div className="sm-row sm-mb sm-wrap">
        <div>
          <div className="sm-title"><GitCompareArrows size={24} className="sm-sec" /><span className="sm-h-sm">Simulated Exposure Comparison</span></div>
          <p className="sm-body sm-mute">All three choices on the same {sc ? sc.evaluatedScenarioCount : '—'} hidden outcomes over {sc ? sc.horizonTradingDays : '—'} trading days. Exposure set before the sampled horizon, not at a trough. None is recommended.</p>
        </div>
        <div className="sm-actions">
          <span className="sm-pill sm-mute">STATUS: {sc ? sc.status.toUpperCase() : 'AWAITING RUN'}{stale ? ' · STALE' : ''}</span>
          <button type="button" className="sm-btn-q" onClick={exportCsv} disabled={!report} data-testid="button-export-csv"><Download size={14} /> CSV</button>
          <button type="button" className="sm-btn-q" onClick={exportJson} disabled={!report} data-testid="button-export-json"><Download size={14} /> JSON</button>
        </div>
      </div>
      <div className="sm-cmp">
        <div className="sm-cmp-plot sm-cmp-table">
          {!sc ? <div className="sm-empty">No comparison yet. Run the rehearsal above.</div>
            : sc.status === 'unavailable' ? <div className="sm-empty sm-err">Unavailable: {sc.message}</div>
            : <table className="sm-table"><thead><tr><th>Choice</th><th>Exposure / cash</th><th>Worst outcome</th><th>Best outcome</th><th>Tail loss</th><th>Median end value</th><th>Within limit</th></tr></thead>
              <tbody>{sc.choices.map((x) => <tr key={x.id} className={x.id === choice ? 'is-sel' : ''} onClick={() => setChoice(x.id)}>
                <td><b>{x.label}</b></td><td>{x.exposurePct}% / {x.cashPct}%<small>{inr(x.marketValueInr)} / {inr(x.cashValueInr)}</small></td>
                <td>{lossLabel(x.worstLossInr)}</td><td>{gainLabel(x.bestGainInr)}</td><td>{inr(x.tailLossInr)}</td><td>{inr(x.medianEndValueInr)}</td>
                <td>{x.withinLimitCount !== null ? `${x.withinLimitCount} / ${sc.evaluatedScenarioCount}` : '—'}{x.coverageScorePct !== null && <small>{x.coverageScorePct}%</small>}</td></tr>)}</tbody></table>}
        </div>
        <div className="sm-metrics">
          <div className="sm-metric"><div className="sm-label sm-mute">SELECTED: {sel ? sel.label.toUpperCase() : '—'} · WORST</div><div className="sm-h-md sm-sec" data-testid="text-choice-worst">{sel ? lossLabel(sel.worstLossInr) : '—'}</div></div>
          <div className="sm-metric"><div className="sm-label sm-mute">SELECTED · BEST</div><div className="sm-h-md sm-pri" data-testid="text-choice-best">{sel ? gainLabel(sel.bestGainInr) : '—'}</div></div>
          <div className="sm-metric"><div className="sm-label sm-mute">ORIGINAL LIMIT CHECK (UNCHANGED BY CHOICE)</div><div className="sm-body">{pg && pg.withinLimitCount !== null ? `${pg.withinLimitCount} / ${pg.evaluatedScenarioCount} within ${inr(pg.lossLimitInr)}` : '—'}{pg?.coverageScorePct != null ? ` · score ${pg.coverageScorePct}%` : ''}</div></div>
        </div>
      </div>
      {stale && <p className="sm-note sm-err">This table and its downloads contain the previous result, using the returned limit and settings—not your edited inputs.</p>}
      {sc?.status === 'available' && <p className="sm-note">Tail loss is CVaR at {report?.settings.confidencePct}% confidence over {sc.horizonTradingDays} trading days. Negative loss means gain; negative best gain means all sampled outcomes lost.</p>}
      {sc && <ul className="sm-list">{sc.assumptions.map((a) => <li key={a}>{a}</li>)}<li>Cash earns zero interest; no taxes, fees, slippage or reinvestment.</li></ul>}
      {report && <div className="sm-kv">
        <div><span>Levels</span><b>{L?.status === 'available' ? `Level ${L.level ?? '—'} · ${L.label}` : `Unavailable: ${L?.reason}`}</b></div>
        <div><span>Current / benchmark CVaR</span><b>{inr(L?.currentCvarInr)} / {inr(L?.parCvarInr)}</b></div>
        <div><span>Source / as of</span><b>{report.source} (prototype) / {report.valuationDate ?? '—'}</b></div>
        <div><span>Coverage</span><b>{report.coverageStatus} · {report.coverageStart ?? '—'} – {report.coverageEnd ?? '—'}</b></div>
        <div><span>Valid returns / excluded</span><b>{report.validReturnCount} / {report.excludedIntervalCount}</b></div>
        <div><span>Checked</span><b>{report.checkedAt}</b></div>
      </div>}
      {report && <p className="sm-note">Levels compare current CVaR with a same-holdings, long-only, fully invested, no-leverage, equal-component-CVaR benchmark ({report.settings.benchmarkMethod}). Not changed by the exposure choice; not an allocation recommendation.</p>}
      {report && report.instruments.length > 0 && <div className="sm-chips">{report.instruments.map((i, k) => <span key={`${i.ticker}-${k}`} className={`sm-chip ${i.dataType}`}>{i.ticker}: {i.dataType === 'observed' ? 'Observed' : i.dataType === 'proxy' ? `Proxy${i.proxyInstrument ? ` (${i.proxyInstrument})` : ''}` : 'Insufficient'}</span>)}</div>}
      {report && <details className="sm-note"><summary>History details and benchmark certification</summary>
        <p className="sm-note">{L?.reason}</p>
        {report.instruments.map((i, k) => <p className="sm-note" key={`${i.ticker}-${k}`}>{i.ticker}: {i.dataType}; source {i.sourceSymbol ?? 'not reported'}{i.proxyInstrument ? `; proxy ${i.proxyInstrument}` : ''}; {i.coverageStart ?? 'not reported'} – {i.coverageEnd ?? 'not reported'}. {i.note}</p>)}
      </details>}
      {report && <ul className="sm-list">{report.settings.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}
      {report?.notes.map((n, k) => <p key={k} className="sm-note">{n}</p>)}
    </section>

    <div className="sm-disc"><Info size={20} /><p className="sm-small sm-mute"><b>For learning only.</b> No real trades, financial advice or predictions. Scenarios use observed history or clearly labeled proxies from Yahoo Finance. The data may be incomplete.</p></div>
  </div>;
}
