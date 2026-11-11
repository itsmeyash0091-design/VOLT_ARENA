import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3, ClipboardCheck, CloudLightning, Dices, FlaskConical, Gauge, History, Info, Layers,
  LayoutDashboard, LifeBuoy, Lock, Map as MapIcon, Menu, Radar, ShieldCheck, Siren, Target, Timer,
  TrendingUp, Trophy, X,
} from 'lucide-react';
import './app-shell.css';

type StationId = 'portfolio' | 'crash' | 'risklab' | 'simulator' | 'report';
type FeatureId = 'replay' | 'risk' | 'recovery' | 'scenarios' | 'reverse' | 'monte' | 'levels' | 'panic' | 'card';
type Status = 'result' | 'panel' | 'locked';

type Station = {
  id: StationId; label: string; icon: typeof LayoutDashboard; kicker: string; title: string; deck: string;
  echo: string; group?: string; disclaimer: string;
};
type Feature = { id: FeatureId; station: StationId; label: string; icon: typeof History; result: string[]; echo: string; group?: string };

const stations: Station[] = [
  { id: 'portfolio', label: 'Portfolio', icon: LayoutDashboard, kicker: 'PORTFOLIO ASSET INPUT // SESSION ONLY',
    title: 'Dock your holdings', deck: 'Add holdings, upload a CSV or try the marked sample. Review, confirm, then inspect the market history.',
    echo: 'Hi, I am Echo. Start here: add your holdings, confirm them, then inspect the market history. Every station opens up once that inspection is done.',
    disclaimer: 'Holdings stay in this browser session only. CSV preview and validation use temporary server memory; nothing is saved. Market history is fetched only after you confirm.' },
  { id: 'crash', label: 'Crash Analytics', icon: CloudLightning, kicker: 'HISTORICAL REPLAY // CURRENT HOLDINGS', group: '#risk-analysis',
    title: 'Past crashes, current holdings', deck: 'Replay the holdings you confirmed through documented market windows. Risk contributors and recovery time sit in the Risk Lab.',
    echo: 'Replay runs your current holdings through past market windows. It is hypothetical: you may not have owned these then.',
    disclaimer: 'Hypothetical replay of current holdings against past prices. Replay values are adjusted-close calculations, not account statements. Past windows do not predict future crashes.' },
  { id: 'risklab', label: 'Risk Lab', icon: FlaskConical, kicker: 'STRESS & SIMULATION // WHAT-IF ONLY', group: '#stress-lab',
    title: 'Portfolio risk & stress lab', deck: 'Look at simulated paths, find how far a shock pattern must stretch to reach a loss you name, and see risk contributors and recovery time.',
    echo: 'Monte Carlo draws many simulated paths from blocks of historical returns. These are what-ifs, not predictions.',
    disclaimer: 'Static shocks are hypothetical. Monte Carlo paths are simulated from blocks of past returns; they are neither observed prices nor predictions.' },
  { id: 'simulator', label: 'Simulator', icon: Siren, kicker: 'PANIC REHEARSAL // NON-TRADING', group: '#resilience-lab',
    title: 'Turbulence & panic rehearsal', deck: 'Declare a rupee loss limit you could sit through, reveal one hidden simulated loss, then pause and reflect.',
    echo: 'Set a hypothetical rupee loss limit, see how simulated losses compare, then pause for reflection. This changes neither your holdings nor your Levels. No real trades happen here.',
    disclaimer: 'No real orders, no live trading, no financial advice. Choices are a reflection exercise only; no choice is labeled best or right.' },
  { id: 'report', label: 'Report', icon: ClipboardCheck, kicker: 'SESSION DEBRIEF // RETURNED VALUES ONLY', group: '#resilience-lab',
    title: 'Simulation debrief', deck: 'Levels, the Crash Card and a plain readout of every figure the analysis service returned in this session.',
    echo: 'Levels compare the portfolio’s tail loss with an equal-risk benchmark using the same holdings. This is an analytical comparison, not an allocation recommendation. If the benchmark cannot be computed, Levels stay unavailable.',
    disclaimer: 'Every figure comes from the analysis service. Unavailable values stay unavailable. The debrief contains no recommendations and nothing is saved.' },
];

const features: Feature[] = [
  { id: 'replay', station: 'crash', label: 'Replay', icon: History,
    result: ['[data-testid="risk-analysis-report"] .risk-window-list', '[data-testid="risk-analysis-report"]'],
    echo: 'Replay runs your current holdings through past market windows. It is hypothetical: you may not have owned these then.' },
  { id: 'monte', station: 'risklab', label: 'Explore possible paths', icon: Dices,
    result: ['[data-testid="section-monte-carlo"]'],
    echo: 'Monte Carlo draws many simulated paths from blocks of historical returns. These are what-ifs, not predictions.' },
  { id: 'reverse', station: 'risklab', label: 'Reverse stress', icon: Target,
    result: ['[data-testid="section-reverse-stress"]'],
    echo: 'Reverse stress starts from a loss you name and asks what kind of move would get there.' },
  { id: 'risk', station: 'risklab', group: '#risk-analysis', label: 'Risk contributors', icon: BarChart3,
    result: ['[data-testid="risk-contribution"]'],
    echo: 'Risk contribution shows how each holding adds to the portfolio risk measured from the available history.' },
  { id: 'recovery', station: 'risklab', group: '#risk-analysis', label: 'Recovery time', icon: Timer,
    result: ['[data-testid="risk-analysis-report"] .risk-window-snapshot', '[data-testid="risk-analysis-report"]'],
    echo: 'Recovery time lives inside each replay window. "Not recovered" means no return to the old peak within the history available.' },
  { id: 'scenarios', station: 'risklab', label: 'Scenarios', icon: MapIcon,
    result: ['[data-testid="section-scenario-impact"]'],
    echo: 'Scenarios apply the shocks you choose. They are simulated what-ifs, not forecasts.' },
  { id: 'panic', station: 'simulator', label: 'Panic game', icon: Gauge,
    result: ['[data-testid="section-panic-game"]'],
    echo: 'Set a hypothetical rupee loss limit, see how simulated losses compare, then pause for reflection. This changes neither your holdings nor your Levels. No real trades happen here.' },
  { id: 'levels', station: 'report', label: 'Levels', icon: Trophy,
    result: ['[data-testid="section-levels"]'],
    echo: 'Levels compare the portfolio’s tail loss with an equal-risk benchmark using the same holdings. This is an analytical comparison, not an allocation recommendation. If the benchmark cannot be computed, Levels stay unavailable.' },
  { id: 'card', station: 'report', label: 'Crash Card', icon: Layers,
    result: ['[data-testid="section-crash-card"]'],
    echo: 'The Crash Card is a short note you can copy and keep for a rough day. It stays in this session only.' },
];

const groupGuidance = 'This station has not produced a result yet. You are at its panel: run it there when you are ready. Navigation never starts an analysis.';

function featureStatus(f: Feature): Status {
  for (const sel of f.result) if (document.querySelector(sel)) return 'result';
  const group = f.group ?? stations.find((s) => s.id === f.station)?.group;
  return group && document.querySelector(group) ? 'panel' : 'locked';
}

const stationIds = stations.map((s) => s.id);
const fromHash = (): StationId | null => {
  const h = window.location.hash.replace(/^#/, '') as StationId;
  return stationIds.includes(h) ? h : null;
};
const writeHash = (id: StationId) => {
  if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
};

export function AppShell({ children }: { children: ReactNode }) {
  const [station, setStation] = useState<StationId>(() => fromHash() ?? 'portfolio');
  const [feature, setFeature] = useState<FeatureId | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const next: Record<string, Status> = {};
    features.forEach((f) => { next[f.id] = featureStatus(f); });
    stations.forEach((s) => { next[s.id] = !s.group ? 'result' : document.querySelector(s.group) ? 'panel' : 'locked'; });
    setStatuses((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, []);

  useEffect(() => {
    refresh();
    const node = stageRef.current;
    if (!node) return;
    let frame = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); });
    obs.observe(node, { childList: true, subtree: true });
    return () => { obs.disconnect(); cancelAnimationFrame(frame); };
  }, [refresh]);

  useEffect(() => {
    const onHash = () => { const id = fromHash(); if (id) { setStation(id); setFeature(null); setNote(''); } };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); };
  }, []);

  const scrollTo = (el: Element | null) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
  };

  const goStation = (id: StationId) => {
    setStation(id); setFeature(null); setNote(''); setMenuOpen(false); writeHash(id);
    scrollTo(mainRef.current);
  };

  const goFeature = (f: Feature) => {
    setStation(f.station); setFeature(f.id); setMenuOpen(false); writeHash(f.station);
    requestAnimationFrame(() => {
      const st = featureStatus(f);
      setNote(st === 'result' ? '' : st === 'panel' ? groupGuidance : '');
      let el: Element | null = null;
      if (st === 'result') { for (const sel of f.result) { el = document.querySelector(sel); if (el) break; } }
      else el = document.querySelector(f.group ?? stations.find((s) => s.id === f.station)?.group ?? '') ?? mainRef.current;
      scrollTo(el);
    });
  };

  const current = stations.find((s) => s.id === station) ?? stations[0];
  const currentFeature = features.find((f) => f.id === feature);
  const echoLine = currentFeature ? currentFeature.echo : current.echo;
  const locked = station !== 'portfolio' && statuses[station] === 'locked';
  const stationFeatures = features.filter((f) => f.station === station);
  const resultCount = features.filter((f) => statuses[f.id] === 'result').length;
  const StationIcon = current.icon;

  return <div className="shell" data-station={station}>
    <a href="#shell-stage" className="shell-skip">Skip to workspace</a>

    <aside className={`ef-side ${menuOpen ? 'is-open' : ''}`} aria-label="Echo Fleet stations">
      <div className="ef-brand">
        <TrendingUp size={22} />
        <div><b>ECHO_FLEET</b><small>BY VOLTARENA // 2090</small></div>
        <button type="button" className="ef-side-close" onClick={() => setMenuOpen(false)} aria-label="Close menu" data-testid="button-close-menu"><X size={18} /></button>
      </div>
      <nav className="ef-nav">
        {stations.map((s) => {
          const Icon = s.icon;
          const st = statuses[s.id] ?? (s.id === 'portfolio' ? 'result' : 'locked');
          return <button type="button" key={s.id} className={`ef-nav-item ${station === s.id ? 'is-active' : ''}`}
            aria-current={station === s.id ? 'page' : undefined} onClick={() => goStation(s.id)} data-testid={s.id === 'portfolio' ? 'nav-portfolio' : `nav-station-${s.id}`}>
            <Icon size={18} /><span>{s.label}</span>{st === 'locked' && <Lock size={12} className="ef-nav-lock" aria-label="needs inspection first" />}
          </button>;
        })}
      </nav>
      <div className="ef-side-features">
        <span className="ef-side-label">ALL NINE TOOLS</span>
        {features.map((f) => {
          const Icon = f.icon; const st = statuses[f.id] ?? 'locked';
          const stLabel = st === 'result' ? 'result shown' : st === 'panel' ? 'ready to run' : 'needs inspection first';
          return <button type="button" key={f.id} className={`ef-side-feature st-${st} ${feature === f.id ? 'is-active' : ''}`} onClick={() => goFeature(f)}
            aria-label={`${f.label}, ${stLabel}`} title={stLabel} data-testid={`nav-${f.id}`}>
            <Icon size={13} /><span>{f.label}</span><i className="shell-dot" aria-hidden="true" />
          </button>;
        })}
      </div>
      <div className="ef-side-foot">
        <span>MARKET DATA FEED</span>
        <p><i className="ef-pulse" /> Yahoo Finance via the analysis service. Limited prototype source.</p>
      </div>
    </aside>
    {menuOpen && <button type="button" className="ef-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

    <div className="ef-main" ref={mainRef}>
      <header className="ef-top">
        <button type="button" className="ef-menu" onClick={() => setMenuOpen(true)} aria-label="Open stations menu" data-testid="button-open-menu"><Menu size={18} /></button>
        <span className="ef-chip">FICTIONAL 2090</span>
        <span className="ef-chip ef-chip-quiet"><ShieldCheck size={12} /> HOLDINGS: SESSION ONLY</span>
        <div className="ef-top-right">
          <div><b>{resultCount} / 9 tools</b><small>returned this session</small></div>
          <span className="ef-avatar" aria-hidden="true"><Radar size={16} /></span>
        </div>
      </header>

      {station !== 'portfolio' && <section className="ef-hero" aria-labelledby="station-title">
        <div className="ef-hero-copy">
          <div className="ef-kicker"><span className="ef-tag">{current.label.toUpperCase()}</span> {current.kicker}</div>
          <h1 id="station-title"><StationIcon size={30} /> {current.title}</h1>
          <p>{current.deck}</p>
        </div>
        <div className="ef-echo shell-echo">
          <div className="ef-echo-head"><Radar size={14} /><b>Echo</b><span>FIXED GUIDE TEXT</span></div>
          <p key={`${station}-${feature}`} className="shell-echo-line" data-testid="text-echo-guidance">{echoLine}</p>
          {note && <p className="shell-echo-note" role="status" data-testid="text-echo-nav-note"><LifeBuoy size={13} /> {note}</p>}
        </div>
      </section>}

      {stationFeatures.length > 0 && <div className="ef-tabs" role="group" aria-label={`${current.label} tools`}>
        {stationFeatures.map((f) => {
          const Icon = f.icon; const st = statuses[f.id] ?? 'locked';
          return <button type="button" key={f.id} className={`ef-tab st-${st} ${feature === f.id ? 'is-active' : ''}`} onClick={() => goFeature(f)} data-testid={`tab-${f.id}`}>
            <Icon size={15} /><span>{f.label}</span><small>{st === 'result' ? 'Result' : st === 'panel' ? 'Ready' : 'Locked'}</small>
          </button>;
        })}
      </div>}

      {locked && <div className="ef-locked" data-testid="panel-station-locked">
        <Lock size={22} />
        <div><strong>This station needs an inspected portfolio</strong><p>Choose Portfolio, add your holdings, then review, confirm and inspect them. Run each tool from its own panel; navigation never starts an analysis.</p></div>
        <button type="button" className="ef-btn ef-btn-primary" onClick={() => goStation('portfolio')} data-testid="button-go-portfolio">Go to Portfolio</button>
      </div>}
      {locked && <div className="ef-skeleton" aria-label="Unavailable tools">
        {stationFeatures.map((f) => { const Icon = f.icon; return <article key={f.id} className="ef-skel-card" data-testid={`card-unavailable-${f.id}`}>
          <header><Icon size={16} /><strong>{f.label}</strong><span>Unavailable</span></header>
          <p>{f.echo}</p>
          <div className="ef-skel-body" aria-hidden="true"><i /><i /><i /></div>
          <small>No values yet. Results appear only after an inspected portfolio and a run started from this panel.</small>
        </article>; })}
      </div>}

      <div className="shell-stage" id="shell-stage" ref={stageRef} tabIndex={-1}>{children}</div>

      {station === 'portfolio' && <div className="ef-echo-strip shell-echo">
        <Radar size={14} /><b>Echo</b><p key={`${station}-${feature}`} className="shell-echo-line" data-testid="text-echo-guidance">{echoLine}</p>
      </div>}
      <aside className="ef-disclaimer" aria-label="Disclaimer">
        <Info size={18} />
        <div><strong>Simulation notice</strong><p>{current.disclaimer}</p></div>
      </aside>
      <dl className="ef-kinds">
        <div><dt className="k-obs">Observed</dt><dd>Prices reported by Yahoo Finance, a limited prototype source. Missing prices stay missing.</dd></div>
        <div><dt className="k-proxy">Proxy</dt><dd>Clearly labeled sector-index history for stock gaps only. Never used for ETFs.</dd></div>
        <div><dt className="k-sim">Simulated</dt><dd>What-if shocks and paths, not observed prices. Past replay of current holdings is hypothetical.</dd></div>
      </dl>
      <footer className="shell-foot">
        <span>Echo Fleet by VoltArena</span>
        <p>Fictional 2090 setting. Educational only: no predictions, no real trades, no advice. Holdings live in this session only.</p>
      </footer>
    </div>
  </div>;
}
