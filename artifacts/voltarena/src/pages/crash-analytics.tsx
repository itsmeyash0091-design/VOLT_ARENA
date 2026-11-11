import { useEffect, useRef, useState } from 'react';
import { Award, Database, Info, LoaderCircle, Medal, Play, Pause, RotateCcw, Zap } from 'lucide-react';
import { useAnalyzePortfolioRisk } from '@workspace/api-client-react';
import type { PortfolioHolding, PortfolioRiskAnalysisReport, ReplayWindowResult } from '@workspace/api-client-react';
import './crash-analytics.css';

type CardMeta = { key: string; apiId?: string; title: string; description: string; tone: 'pri' | 'sec' };

// Static, non-financial historical names/descriptions. Only apiId windows exist in the analysis service.
const cards: CardMeta[] = [
  { key: 'gfc', apiId: 'global-financial-crisis', title: '2008 Global Meltdown (GFC)', tone: 'pri',
    description: 'Global credit stress and foreign capital flight. Replays your current holdings through this window.' },
  { key: 'covid', apiId: 'covid-selloff', title: '2020 COVID Panic Shock', tone: 'sec',
    description: 'A very fast pandemic selloff. Replays your current holdings through this window.' },
  { key: 'bombay', title: '1992 Bombay Bubble Crash', tone: 'pri',
    description: 'Securities scam aftermath on BSE. This window is not configured in the analysis service.' },
  { key: 'taper', title: '2013 Taper Tantrum', tone: 'sec',
    description: 'Rupee stress during US Fed tapering. This window is not configured in the analysis service.' },
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

export function CrashAnalytics({ holdings, inspectionKey, onReturn }: { holdings: PortfolioHolding[]; inspectionKey?: string; onReturn: () => void }) {
  const analyze = useAnalyzePortfolioRisk();
  const reqId = useRef(0);
  const [report, setReport] = useState<PortfolioRiskAnalysisReport>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('covid');
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showDetails, setShowDetails] = useState(false);

  const meta = cards.find((c) => c.key === selected) ?? cards[1];
  const win = meta.apiId ? report?.replayWindows.find((w) => w.id === meta.apiId) : undefined;
  const path = win?.path ?? [];
  const last = Math.max(path.length - 1, 0);
  const cur = Math.min(idx, last);

  useEffect(() => {
    if (!playing) return;
    if (cur >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setIdx((i) => i + 1), 140 / speed);
    return () => clearTimeout(t);
  }, [playing, cur, last, speed]);

  const run = () => {
    if (!inspectionKey || !holdings.length || analyze.isPending) return;
    const id = ++reqId.current;
    setError('');
    analyze.mutate({ data: { holdings } }, {
      onSuccess: (r) => { if (id === reqId.current) { setReport(r); setIdx(0); } },
      onError: (e) => { if (id === reqId.current) setError(errorMessage(e)); },
    });
  };

  const pick = (c: CardMeta) => {
    setSelected(c.key); setIdx(0); setPlaying(false); setShowDetails(false);
    if (c.apiId && !report) run();
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

  return <div className="ca">
    <div className="ca-head">
      <div>
        <div className="ca-tags"><span className="ca-tag">MARKET STRESS LAB // H-004</span><span className="ca-sec ca-label">// HISTORICAL VOLATILITY REPLAY</span></div>
        <h1 className="ca-h-lg">Past Crashes: Indian Market Crash Replays</h1>
        <p className="ca-mute">Replay your current holdings through past market windows. Hypothetical: you may not have owned them then.</p>
      </div>
      <div className="ca-xp"><span><Zap size={20} /></span><div><div className="ca-label ca-mute">TOTAL XP ACCRUED</div><div className="ca-h-sm ca-pri">—</div></div></div>
    </div>

    <section className="ca-block">
      <div className="ca-row"><h2 className="ca-h-md">Select Historical Past Crash</h2><span className="ca-sec ca-sm">2 OF 4 CONFIGURED</span></div>
      <div className="ca-cards">
        {cards.map((c) => {
          const w = c.apiId ? report?.replayWindows.find((x) => x.id === c.apiId) : undefined;
          return <button type="button" key={c.key} className={`ca-card ${selected === c.key ? 'is-active' : ''} ${c.apiId ? '' : 'is-off'}`} onClick={() => pick(c)} data-testid={`card-crash-${c.key}`}>
            <i className={`ca-blob ${c.tone}`} />
            <div>
              <div className={`ca-sm ca-b ${c.tone === 'pri' ? 'ca-pri' : 'ca-sec'}`}>{c.apiId ? `${pct(w?.maxDrawdownPct)} MAX DD` : 'NOT CONFIGURED'}</div>
              <div className="ca-label ca-sec ca-dates">{w ? `${monthLabel(w.startDate)} - ${monthLabel(w.endDate)}` : c.apiId ? 'DATES FROM ANALYSIS' : 'NO DATA WINDOW'}</div>
              <h3 className="ca-h-sm">{c.title}</h3>
              <p className="ca-sm ca-mute">{c.description}</p>
            </div>
            <div className="ca-card-foot ca-sm">
              <span className={`ca-b ${c.tone === 'pri' ? 'ca-pri' : 'ca-sec'}`}><Play size={14} /> {c.apiId ? (w ? 'VIEW REPLAY' : 'ANALYZE CRASH') : 'UNAVAILABLE'}</span>
              <span className="ca-mute">— XP</span>
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
        </div>
      </div>

      <div className="ca-viz">
        <div className="ca-chart">
          <div className="ca-chart-top">
            <div className="ca-legend">
              <span><i className="pri" /><b>Your Portfolio (current holdings, hypothetical)</b></span>
              <span className="ca-mute"><i className="sec off" />Benchmark: not provided</span>
            </div>
            <div className="ca-h-sm ca-pri" data-testid="text-replay-point">{point ? `${point.normalizedValueIndex}` : '—'}<small>{point ? ` ${point.date}` : ''}</small></div>
          </div>
          <div className="ca-svg">
            {path.length > 1 ? <svg viewBox="0 0 800 200" preserveAspectRatio="none">
              {[0, 50, 100, 150].map((y) => <line key={y} x1="0" x2="800" y1={y} y2={y} stroke="#31353f" strokeDasharray="4" />)}
              <polyline points={full} fill="none" stroke="#ffb694" strokeOpacity=".18" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <polyline points={played} fill="none" stroke="#ffb694" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            </svg> : <div className="ca-empty">
              {analyze.isPending ? <><LoaderCircle className="ca-spin" size={22} /> Replaying holdings through past windows…</>
                : locked ? 'Confirm and inspect your holdings on Portfolio first.'
                : !meta.apiId ? 'This crash window is not configured in the analysis service. No replay data.'
                : !report ? <>No replay yet. <button type="button" className="ca-link" onClick={run} data-testid="button-analyze-crash">Analyze crash</button></>
                : win?.status === 'unavailable' || !win ? 'Replay unavailable for this window with your holdings. See data details.'
                : 'Not enough points returned to draw a path.'}
            </div>}
            {point && path.length > 1 && <span className="ca-cursor" style={{ left: `${(X(cur) / 800) * 100}%`, top: `${(Y(point.normalizedValueIndex) / 200) * 100}%` }} />}
          </div>
          <div className="ca-scrub">
            <input type="range" min={0} max={last} value={cur} disabled={path.length < 2} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} aria-label="Replay timeline" data-testid="input-replay-scrubber" />
            <div className="ca-label ca-mute ca-row"><span>{path[0]?.date ?? '—'}</span><span>Crash Timeline (Current Point)</span><span>{path[last]?.date ?? '—'}</span></div>
          </div>
          {win && <p className="ca-sm ca-mute" role="note">
            {win.status.toUpperCase()} · Coverage: {win.coverageStart ?? '—'} – {win.coverageEnd ?? '—'}.
            {' '}{win.instruments.some((i) => i.dataType === 'proxy') ? 'Includes labelled proxy history.' : 'No proxy history used.'}
            {win.instruments.some((i) => i.dataType === 'insufficient') && ' Some holdings have insufficient history.'}
            {' '}Source: {report?.source ?? 'Not returned'} (prototype). See data details for each holding.
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
      {showDetails && win && report && <div className="ca-details" data-testid="panel-replay-details">
        <div className="ca-kv">
          <div><span>Source</span><b>{report.source}</b></div>
          <div><span>Analysed at</span><b>{report.checkedAt}</b></div>
          <div><span>Window</span><b>{win.startDate} – {win.endDate}</b></div>
          <div><span>Coverage</span><b>{win.coverageStart ?? '—'} – {win.coverageEnd ?? '—'}</b></div>
          <div><span>Status</span><b>{win.status}</b></div>
          <div><span>Observations</span><b>{win.observationCount}</b></div>
          <div><span>Peak value</span><b>{inr(win.peakValue)}</b></div>
          <div><span>Recovery date</span><b>{win.recoveryDate ?? '—'}</b></div>
        </div>
        <table className="ca-table"><thead><tr><th>Holding</th><th>Data</th><th>Source symbol</th><th>Coverage</th><th>Note</th></tr></thead>
          <tbody>{win.instruments.map((i) => <tr key={i.ticker}><td>{i.ticker}</td><td><span className={`ca-chip ${i.dataType}`}>{i.dataType === 'observed' ? 'Observed' : i.dataType === 'proxy' ? `Proxy${i.proxyInstrument ? `: ${i.proxyInstrument}` : ''}` : 'Insufficient'}</span></td><td>{i.sourceSymbol ?? '—'}</td><td>{i.coverageStart ?? '—'} – {i.coverageEnd ?? '—'}</td><td>{i.note}</td></tr>)}</tbody></table>
        {[...win.notes, ...report.methodNotes].map((n, k) => <p key={k} className="ca-sm ca-mute">{n}</p>)}
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
      <div className="ca-foot-l"><span className="ca-medal"><Award size={24} /></span><div><div className="ca-h-sm">Crash Summary &amp; Badges Unlocked</div><div className="ca-sm ca-mute">{report ? `Replay returned for ${analysed} of 2 configured windows. XP not tracked.` : 'No replay run in this session. XP not tracked.'}</div></div></div>
      <div className="ca-foot-r">
        <div className="ca-badge"><Medal size={20} /><b className="ca-sm">Badge: not tracked</b></div>
        <button type="button" className="ca-sync" onClick={onReturn} data-testid="button-return-portfolio">RETURN TO PORTFOLIO</button>
      </div>
    </footer>
  </div>;
}
