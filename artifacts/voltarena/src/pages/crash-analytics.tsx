import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Award, Database, Download, Info, LoaderCircle, Medal, Play, Pause, RefreshCw, RotateCcw, Table2, Zap } from 'lucide-react';
import { useAnalyzePortfolioRisk } from '@workspace/api-client-react';
import type { PortfolioHolding, PortfolioRiskAnalysisReport, ReplayWindowResult } from '@workspace/api-client-react';
import './crash-analytics.css';

type CardMeta = { key: string; apiId?: string; title: string; description: string; tone: 'pri' | 'sec' };

// Static, non-financial names/descriptions. Window dates come from the analysis service; they are analysis intervals, not verified peak/trough dates.
const cards: CardMeta[] = [
  { key: 'gfc', apiId: 'global-financial-crisis', title: '2008 Global Meltdown (GFC)', tone: 'pri',
    description: 'Global credit stress and foreign capital flight. Replays your current holdings through this window.' },
  { key: 'covid', apiId: 'covid-selloff', title: '2020 COVID Panic Shock', tone: 'sec',
    description: 'A very fast pandemic selloff. Replays your current holdings through this window.' },
  { key: 'bombay', apiId: 'bombay-bubble', title: '1992 Bombay Bubble Crash', tone: 'pri',
    description: 'Securities scam aftermath on BSE. Replays your current holdings through this window.' },
  { key: 'taper', apiId: 'taper-tantrum', title: '2013 Taper Tantrum', tone: 'sec',
    description: 'Rupee stress during US Fed tapering. Replays your current holdings through this window.' },
];

const inr = (v: number | null | undefined) => v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v}%`;
const monthLabel = (d: string) => { const t = new Date(`${d}T00:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).toUpperCase(); };
const recoveryLabel = (w: ReplayWindowResult) => w.recoveryTradingDays !== null ? `${w.recoveryTradingDays} days`
  : w.recoveryStatus === 'not_recovered' ? 'Not recovered in available history' : w.recoveryStatus === 'incomplete' ? 'Incomplete' : '—';

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The analysis service could not complete the replay.';
}

export function CrashAnalytics({ holdings, inspectionKey, onReturn, onCompleted }: { holdings: PortfolioHolding[]; inspectionKey?: string; onReturn: () => void; onCompleted?: () => void }) {
  const analyze = useAnalyzePortfolioRisk();
  const reqId = useRef(0);
  const [report, setReport] = useState<PortfolioRiskAnalysisReport>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('covid');
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showDetails, setShowDetails] = useState(false);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const subsetRun = useAnalyzePortfolioRisk();
  const subsetReq = useRef(0);
  const [subset, setSubset] = useState<{ windowId: string; included: string[]; excluded: string[]; report: PortfolioRiskAnalysisReport }>();
  const [subsetError, setSubsetError] = useState('');
  const [confirmSubset, setConfirmSubset] = useState(false);
  const [scope, setScope] = useState<'full' | 'subset'>('full');

  const meta = cards.find((c) => c.key === selected) ?? cards[1];
  const fullWin = meta.apiId ? report?.replayWindows.find((w) => w.id === meta.apiId) : undefined;
  const subsetActive = scope === 'subset' && !!subset && subset.windowId === meta.apiId;
  const win = subsetActive ? subset.report.replayWindows.find((w) => w.id === meta.apiId) : fullWin;
  // Non-financial eligibility from Python coverage labels: holdings not marked insufficient for this window.
  const blockers = fullWin ? fullWin.instruments.filter((i) => i.dataType === 'insufficient') : [];
  // Python preserves submitted order. Check it before matching coverage by row,
  // so identical symbols on different exchanges cannot be silently conflated.
  const coverageMatchesHoldings = !!fullWin && fullWin.instruments.length === holdings.length
    && fullWin.instruments.every((instrument, index) => instrument.ticker === holdings[index].ticker);
  const eligibleHoldings = coverageMatchesHoldings
    ? holdings.filter((_holding, index) => fullWin!.instruments[index].dataType !== 'insufficient') : [];
  const holdingLabel = (h: PortfolioHolding) => `${h.ticker} (${h.exchange})`;
  const excludedHoldings = holdings.filter((h) => !eligibleHoldings.includes(h));
  const canSubset = !!fullWin && fullWin.status !== 'complete' && blockers.length > 0 && eligibleHoldings.length > 0 && eligibleHoldings.length < holdings.length;
  const path = win?.path ?? [];
  const last = Math.max(path.length - 1, 0);
  const cur = Math.min(idx, last);

  useEffect(() => () => { reqId.current++; subsetReq.current++; }, []);

  useEffect(() => {
    if (!playing) return;
    if (cur >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setIdx((i) => i + 1), 140 / speed);
    return () => clearTimeout(t);
  }, [playing, cur, last, speed]);

  const run = () => {
    if (!inspectionKey || !holdings.length || analyze.isPending) return;
    const id = ++reqId.current;
    setError(''); setPlaying(false); setScope('full'); setConfirmSubset(false); subsetReq.current++; setSubset(undefined); setSubsetError('');
    analyze.mutate({ data: { holdings } }, {
      onSuccess: (r) => { if (id === reqId.current) { setReport(r); setIdx(0); setPlaying((r.replayWindows.find((w) => w.id === meta.apiId)?.path.length ?? 0) > 1); if (r.replayWindows.some((w) => w.status !== 'unavailable')) onCompleted?.(); } },
      onError: (e) => { if (id === reqId.current) setError(errorMessage(e)); },
    });
  };

  const runSubset = () => {
    if (!fullWin || !canSubset || subsetRun.isPending) return;
    const windowId = fullWin.id;
    const included = eligibleHoldings.map(holdingLabel);
    const excluded = excludedHoldings.map(holdingLabel);
    const id = ++subsetReq.current;
    setSubsetError(''); setConfirmSubset(false);
    subsetRun.mutate({ data: { holdings: eligibleHoldings } }, {
      onSuccess: (r) => { if (id === subsetReq.current) { setSubset({ windowId, included, excluded, report: r }); setScope('subset'); setIdx(0); setPlaying((r.replayWindows.find((w) => w.id === windowId)?.path.length ?? 0) > 1); } },
      onError: (e) => { if (id === subsetReq.current) setSubsetError(errorMessage(e)); },
    });
  };

  const pick = (c: CardMeta) => {
    subsetReq.current++;
    setSelected(c.key); setIdx(0); setPlaying(false); setShowDetails(false); setConfirmSubset(false); setScope('full');
  };

  const downloadCsv = () => {
    if (!win || !path.length) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ['Window', `${win.name} (${win.id})`], ['Interval', `${win.startDate} to ${win.endDate}`],
      ['Scope', subsetActive ? `PARTIAL holdings replay, not full portfolio. Included: ${subset.included.join(' ')}. Excluded: ${subset.excluded.join(' ')}` : 'Full current portfolio'],
      ['Source', `${(subsetActive ? subset.report : report)?.source ?? ''} (prototype)`], ['Analysed at', (subsetActive ? subset.report : report)?.checkedAt ?? ''],
      ['Note', 'Hypothetical replay of current holdings on past adjusted closes; not account history; not advice.'],
    ].map((r) => r.map(esc).join(','));
    lines.push('', ['Date', 'Portfolio value (INR)', 'Index (base 100)'].map(esc).join(','));
    path.forEach((pt) => lines.push([pt.date, String(pt.portfolioValue), String(pt.normalizedValueIndex)].map(esc).join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `crash-replay-${win.id}${subsetActive ? '-partial' : ''}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Rendering only: map API-returned points into SVG coordinates.
  const vals = path.map((p) => p.normalizedValueIndex);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || 1;
  const X = (i: number) => (last ? (i / last) * 800 : 0);
  const Y = (v: number) => 190 - ((v - lo) / span) * 180;
  const full = path.map((p, i) => `${X(i)},${Y(p.normalizedValueIndex)}`).join(' ');
  const played = path.slice(0, cur + 1).map((p, i) => `${X(i)},${Y(p.normalizedValueIndex)}`).join(' ');
  const point = path[cur];

  const analysed = report ? report.replayWindows.filter((w) => w.status !== 'unavailable').length : 0;
  const locked = !inspectionKey;
  const fullAvailable = analysed;

  return <div className="ca">
    <div className="ca-head">
      <div>
        <div className="ca-tags"><span className="ca-tag">MARKET STRESS LAB // H-004</span><span className="ca-sec ca-label">// HISTORICAL VOLATILITY REPLAY</span></div>
        <h1 className="ca-h-lg">Past Crashes: Indian Market Crash Replays</h1>
        <p className="ca-mute">Replay your current holdings through past market windows. Hypothetical: you may not have owned them then.</p>
      </div>
      <div className="ca-xp"><span><Zap size={20} /></span><div><div className="ca-label ca-mute">SESSION REPLAY STATUS</div><div className="ca-h-sm ca-pri" data-testid="text-replay-status">{analyze.isPending ? 'RUNNING' : report ? `${fullAvailable} / ${report.replayWindows.length} WITH PATHS` : locked ? 'AWAITING INSPECTION' : 'NOT RUN'}</div></div>
        {!locked && <button type="button" className="ca-link" onClick={run} disabled={analyze.isPending} data-testid="button-analyze-all">{report ? <><RefreshCw size={12} /> Refresh replay</> : 'Analyse & replay'}</button>}</div>
    </div>

    <section className="ca-block">
      <div className="ca-row"><h2 className="ca-h-md">Select Historical Past Crash</h2><span className="ca-sec ca-sm">4 ANALYSIS INTERVALS</span></div>
      <div className="ca-cards">
        {cards.map((c) => {
          const w = c.apiId ? report?.replayWindows.find((x) => x.id === c.apiId) : undefined;
          return <button type="button" key={c.key} className={`ca-card ${selected === c.key ? 'is-active' : ''}`} onClick={() => pick(c)} data-testid={`card-crash-${c.key}`}>
            <i className={`ca-blob ${c.tone}`} />
            <div>
              <div className={`ca-sm ca-b ${c.tone === 'pri' ? 'ca-pri' : 'ca-sec'}`}>{w ? (w.status === 'unavailable' ? 'UNAVAILABLE (FULL)' : `${pct(w.maxDrawdownPct)} MAX DD`) : '— MAX DD'}</div>
              <div className="ca-label ca-sec ca-dates">{w ? `${monthLabel(w.startDate)} - ${monthLabel(w.endDate)}` : 'DATES FROM ANALYSIS'}</div>
              <h3 className="ca-h-sm">{c.title}</h3>
              <p className="ca-sm ca-mute">{c.description}</p>
            </div>
            <div className="ca-card-foot ca-sm">
              <span className={`ca-b ${c.tone === 'pri' ? 'ca-pri' : 'ca-sec'}`}><Play size={14} /> {w ? 'VIEW REPLAY' : 'SELECT'}</span>
              <span className="ca-mute">{w ? w.status.toUpperCase() : 'NOT RUN'}</span>
            </div>
          </button>;
        })}
      </div>
    </section>

    <section className="ca-panel">
      <div className="ca-panel-head">
        <div>
          <div className="ca-tags"><span className="ca-tag ca-tag-on">ACTIVE SCENARIO: {meta.title.toUpperCase()}</span>
            <span className="ca-sec ca-sm">{win?.troughDate ? `TROUGH DATE ${win.troughDate}` : 'TROUGH DATE —'}</span></div>
          <h2 className="ca-h-md">{meta.title} Replay Trajectory</h2>
        </div>
        <div className="ca-controls">
          <button type="button" className="ca-play" onClick={() => { if (cur >= last) setIdx(0); setPlaying((p) => !p); }} disabled={path.length < 2} aria-label={playing ? 'Pause' : 'Play'} data-testid="button-replay-play">{playing ? <Pause size={20} /> : <Play size={20} />}</button>
          <button type="button" className="ca-reset" onClick={() => { setPlaying(false); setIdx(0); }} disabled={!path.length} aria-label="Reset" data-testid="button-replay-reset"><RotateCcw size={20} /></button>
          <i className="ca-div" />
          <span className="ca-label ca-mute">SPEED:</span>
          {[1, 2, 5].map((s) => <button type="button" key={s} className={`ca-speed ${speed === s ? 'is-on' : ''}`} onClick={() => setSpeed(s)} data-testid={`button-speed-${s}`}>{s}X</button>)}
          <i className="ca-div" />
          <button type="button" className="ca-speed" onClick={() => setView((v) => v === 'chart' ? 'table' : 'chart')} disabled={!path.length} data-testid="button-toggle-replay-view"><Table2 size={12} /> {view === 'chart' ? 'TABLE' : 'CHART'}</button>
          <button type="button" className="ca-speed" onClick={downloadCsv} disabled={!path.length} data-testid="button-download-path"><Download size={12} /> CSV</button>
        </div>
      </div>

      {subsetActive && <div className="ca-warn" role="alert" data-testid="banner-partial"><AlertTriangle size={16} /><div><b>Partial holdings replay — not full portfolio.</b> Included: {subset.included.join(', ')}. Excluded: {subset.excluded.join(', ')}. Your session holdings are unchanged. <button type="button" className="ca-link" onClick={() => { setScope('full'); setIdx(0); setPlaying(false); }} data-testid="button-restore-full">Show full portfolio result</button></div></div>}
      {!subsetActive && fullWin && fullWin.status !== 'complete' && blockers.length > 0 && <div className="ca-warn" data-testid="panel-blockers"><AlertTriangle size={16} /><div>
        <b>Your Portfolio holdings are loaded. This is a history limitation, not a missing CSV.</b>
        <p>Full portfolio replay is {fullWin.status} for this window. Missing sufficient history: {blockers.map((b) => b.ticker).join(', ')}. The original holdings will not be removed. Open Data Details for source notes.</p>
        {canSubset ? (confirmSubset ? <div className="ca-confirm">Run a SEPARATE replay using only {eligibleHoldings.map(holdingLabel).join(', ')}? It excludes {excludedHoldings.map(holdingLabel).join(', ')} and is not your full portfolio.
          <span><button type="button" className="ca-cta" onClick={runSubset} disabled={subsetRun.isPending} data-testid="button-confirm-subset">{subsetRun.isPending ? 'Running…' : 'Confirm & start partial replay'}</button> <button type="button" className="ca-link" onClick={() => setConfirmSubset(false)}>Cancel</button></span></div>
          : <div><button type="button" className="ca-cta" onClick={() => setConfirmSubset(true)} disabled={subsetRun.isPending} data-testid="button-offer-subset">{subsetRun.isPending ? 'Loading partial replay…' : 'Choose holdings with available history'}</button></div>)
          : ' No eligible subset is available for this window.'}
        {subset && subset.windowId === fullWin.id && <> <button type="button" className="ca-link" onClick={() => setScope('subset')}>View last partial replay</button></>}
        {subsetError && <span className="ca-err-in"> {subsetError} <button type="button" className="ca-link" onClick={runSubset}>Try again</button></span>}
      </div></div>}

      <div className="ca-viz">
        <div className="ca-chart">
          <div className="ca-chart-top">
            <div className="ca-legend">
              <span><i className="pri" /><b>{subsetActive ? 'Partial holdings (hypothetical)' : 'Your Portfolio (current holdings, hypothetical)'}</b></span>
              <span className="ca-mute"><i className="sec off" />Benchmark: not provided</span>
            </div>
            <div className="ca-h-sm ca-pri" data-testid="text-replay-point">{point ? `Index ${point.normalizedValueIndex}` : '—'}<small>{point ? ` (base 100) · ${inr(point.portfolioValue)} · ${point.date} · point ${cur + 1}/${path.length}` : ''}</small></div>
          </div>
          {view === 'table' && path.length > 0 ? <div className="ca-table-wrap"><table className="ca-table"><thead><tr><th>#</th><th>Date</th><th>Value (INR)</th><th>Index (base 100)</th></tr></thead>
            <tbody>{path.map((pt, i) => <tr key={pt.date} className={i === cur ? 'is-cur' : ''}><td>{i + 1}</td><td>{pt.date}</td><td>{inr(pt.portfolioValue)}</td><td>{pt.normalizedValueIndex}</td></tr>)}</tbody></table></div> : <div className="ca-svg">
            {path.length > 1 ? <svg viewBox="0 0 800 200" preserveAspectRatio="none">
              {[0, 50, 100, 150].map((y) => <line key={y} x1="0" x2="800" y1={y} y2={y} stroke="#31353f" strokeDasharray="4" />)}
              <polyline points={full} fill="none" stroke="#ffb694" strokeOpacity=".18" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <polyline points={played} fill="none" stroke="#ffb694" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            </svg> : <div className="ca-empty">
              {analyze.isPending ? <><LoaderCircle className="ca-spin" size={22} /> Replaying holdings through past windows…</>
                : locked ? 'Confirm and inspect your holdings on Portfolio first.'
                : error && !report ? <span className="ca-err-in">{error} <button type="button" className="ca-link" onClick={run}>Try again</button></span>
                : !report ? <>No replay yet. <button type="button" className="ca-link" onClick={run} data-testid="button-analyze-crash">Analyse all windows</button></>
                : !win ? 'This window was not returned by the analysis service.'
                : win.status === 'unavailable' ? `Replay unavailable for this window${subsetActive ? ' for the partial set' : ' with your full portfolio'}. See blockers and data details.`
                : 'Not enough points returned to draw a path.'}
            </div>}
            {point && path.length > 1 && <span className="ca-cursor" style={{ left: `${(X(cur) / 800) * 100}%`, top: `${(Y(point.normalizedValueIndex) / 200) * 100}%` }} />}
          </div>}
          <div className="ca-scrub">
            <input type="range" min={0} max={last} value={cur} disabled={path.length < 2} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} aria-label="Replay timeline" data-testid="input-replay-scrubber" />
            <div className="ca-label ca-mute ca-row"><span>{path[0]?.date ?? '—'}</span><span>Crash Timeline (Current Point)</span><span>{path[last]?.date ?? '—'}</span></div>
          </div>
          {win && <p className="ca-sm ca-mute" role="note">
            {win.status.toUpperCase()} · Coverage: {win.coverageStart ?? '—'} – {win.coverageEnd ?? '—'}.
            {' '}{win.instruments.some((i) => i.dataType === 'proxy') ? 'Includes labelled proxy history.' : 'No proxy history used.'}
            {win.instruments.some((i) => i.dataType === 'insufficient') && ' Some holdings have insufficient history.'}
            {' '}Source: {(subsetActive ? subset.report : report)?.source ?? 'Not returned'} (prototype), analysed {(subsetActive ? subset.report : report)?.checkedAt ?? '—'}. Interval {win.startDate} – {win.endDate} is an analysis window, not a verified peak/trough. Recovery: trading days from the trough until the prior peak value is regained within available history.
          </p>}
        </div>

        <div className="ca-metrics">
          <div>
            <div className="ca-label ca-sec ca-b">CRASH IMPACT METRICS</div>
            <dl>
              <div><dt className="ca-label ca-mute">MAX DRAWDOWN</dt><dd className="ca-h-md ca-pri" data-testid="text-max-drawdown">{pct(win?.maxDrawdownPct)}</dd></div>
              <div><dt className="ca-label ca-mute">TROUGH VALUE</dt><dd className="ca-h-md ca-sec">{inr(win?.troughValue)}</dd></div>
              <div><dt className="ca-label ca-mute">RECOVERY</dt><dd className="ca-h-md">{win ? recoveryLabel(win) : '—'}</dd></div>
            </dl>
          </div>
          <button type="button" className="ca-cta" onClick={() => setShowDetails((s) => !s)} disabled={!win} data-testid="button-data-details"><Database size={18} /> {showDetails ? 'HIDE DATA DETAILS' : 'VIEW DATA DETAILS'}</button>
        </div>
      </div>

      {error && <p className="ca-err" role="alert">{error} <button type="button" className="ca-link" onClick={run} data-testid="button-retry-analysis">Try again</button></p>}
      {showDetails && win && (subsetActive ? subset.report : report) && <div className="ca-details" data-testid="panel-replay-details">
        <div className="ca-kv">
          <div><span>Source</span><b>{(subsetActive ? subset.report : report)?.source}</b></div>
          <div><span>Analysed at</span><b>{(subsetActive ? subset.report : report)?.checkedAt}</b></div>
          <div><span>Scope</span><b>{subsetActive ? 'Partial holdings, not full portfolio' : 'Full current portfolio'}</b></div>
          <div><span>Trough</span><b>{inr(win.troughValue)} · {win.troughDate ?? '—'}</b></div>
          <div><span>Window</span><b>{win.startDate} – {win.endDate}</b></div>
          <div><span>Coverage</span><b>{win.coverageStart ?? '—'} – {win.coverageEnd ?? '—'}</b></div>
          <div><span>Status</span><b>{win.status}</b></div>
          <div><span>Observations</span><b>{win.observationCount}</b></div>
          <div><span>Peak value</span><b>{inr(win.peakValue)}</b></div>
          <div><span>Recovery date</span><b>{win.recoveryDate ?? '—'}</b></div>
        </div>
        <table className="ca-table"><thead><tr><th>Holding</th><th>Data</th><th>Source symbol</th><th>Coverage</th><th>Note</th></tr></thead>
          <tbody>{win.instruments.map((i) => <tr key={i.ticker}><td>{i.ticker}</td><td><span className={`ca-chip ${i.dataType}`}>{i.dataType === 'observed' ? 'Observed' : i.dataType === 'proxy' ? `Proxy${i.proxyInstrument ? `: ${i.proxyInstrument}` : ''}` : 'Insufficient'}</span></td><td>{i.sourceSymbol ?? '—'}</td><td>{i.coverageStart ?? '—'} – {i.coverageEnd ?? '—'}</td><td>{i.note}</td></tr>)}</tbody></table>
        {[...win.notes, ...((subsetActive ? subset.report : report)?.methodNotes ?? [])].map((n, k) => <p key={k} className="ca-sm ca-mute">{n}</p>)}
      </div>}
    </section>

    <section className="ca-disc">
      <Info size={28} />
      <div>
        <h4 className="ca-h-sm">Crash Replay Disclaimer &amp; Notice</h4>
        <p className="ca-sm ca-mute">Hypothetical replay of your current holdings against past adjusted-close prices from a prototype source. The prices are historical observations (or clearly labelled proxies), not simulations, and the replay is not your account history. Past crashes do not predict future results. Educational only: no advice, no trading. Holdings stay in this session.</p>
      </div>
    </section>

    <footer className="ca-foot">
      <div className="ca-foot-l"><span className="ca-medal"><Award size={24} /></span><div><div className="ca-h-sm">Crash Summary &amp; Badges Unlocked</div><div className="ca-sm ca-mute">{report ? `Full-portfolio replay available for ${analysed} of ${report.replayWindows.length} windows.${subset ? ' A partial replay was also run (not counted).' : ''}` : 'No replay run in this session.'}</div></div></div>
      <div className="ca-foot-r">
        <div className="ca-badge"><Medal size={20} /><b className="ca-sm" data-testid="text-crash-badge">{analysed > 0 ? 'Activity: replay explored' : 'Activity: none yet'}</b></div>
        <button type="button" className="ca-sync" onClick={onReturn} data-testid="button-return-portfolio">RETURN TO PORTFOLIO</button>
      </div>
    </footer>
  </div>;
}
