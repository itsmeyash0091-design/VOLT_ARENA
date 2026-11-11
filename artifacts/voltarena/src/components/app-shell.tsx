import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, BarChart3, Dices, Gauge, History, Home, Layers, LifeBuoy, Map as MapIcon,
  Radar, ShieldCheck, Sparkles, Target, Timer, Trophy,
} from 'lucide-react';
import './app-shell.css';

type FeatureId = 'home' | 'replay' | 'risk' | 'recovery' | 'scenarios' | 'reverse' | 'monte' | 'levels' | 'panic' | 'card';

type Feature = {
  id: FeatureId; label: string; short: string; icon: typeof Home;
  result: string[]; group: string; groupLabel: string; echo: string;
};

const homeEcho = 'Hi, I am Echo. Start here: add your holdings, confirm them, then inspect the market history. Every station below opens up once that inspection is done.';

const features: Feature[] = [
  { id: 'replay', label: 'Replay', short: 'Past crashes, current holdings', icon: History, group: '#risk-analysis', groupLabel: 'Replay & risk',
    result: ['[data-testid="risk-analysis-report"] .risk-window-list', '[data-testid="risk-analysis-report"]'],
    echo: 'Replay runs your current holdings through past market windows. It is hypothetical: you may not have owned these then.' },
  { id: 'risk', label: 'Risk contribution', short: 'Which holdings shape the risk', icon: BarChart3, group: '#risk-analysis', groupLabel: 'Replay & risk',
    result: ['[data-testid="risk-contribution"]'],
    echo: 'Risk contribution shows how each holding adds to the portfolio risk measured from the available history.' },
  { id: 'recovery', label: 'Recovery time', short: 'How long back to the peak', icon: Timer, group: '#risk-analysis', groupLabel: 'Replay & risk',
    result: ['[data-testid="risk-analysis-report"] .risk-window-snapshot', '[data-testid="risk-analysis-report"]'],
    echo: 'Recovery time lives inside each replay window. "Not recovered" means no return to the old peak within the history available.' },
  { id: 'scenarios', label: 'Scenarios', short: 'Set shocks by type', icon: MapIcon, group: '#stress-lab', groupLabel: 'Stress & simulation',
    result: ['[data-testid="section-scenario-impact"]'],
    echo: 'Scenarios apply the shocks you choose. They are simulated what-ifs, not forecasts.' },
  { id: 'reverse', label: 'Reverse stress', short: 'What breaks a loss limit', icon: Target, group: '#stress-lab', groupLabel: 'Stress & simulation',
    result: ['[data-testid="section-reverse-stress"]'],
    echo: 'Reverse stress starts from a loss you name and asks what kind of move would get there.' },
  { id: 'monte', label: 'Monte Carlo', short: 'Many simulated paths', icon: Dices, group: '#stress-lab', groupLabel: 'Stress & simulation',
    result: ['[data-testid="section-monte-carlo"]'],
    echo: 'Monte Carlo draws many simulated paths from blocks of historical returns. These are what-ifs, not predictions.' },
  { id: 'levels', label: 'Levels', short: 'Compare tail loss with par', icon: Trophy, group: '#resilience-lab', groupLabel: 'Levels & rehearsal',
    result: ['[data-testid="section-levels"]'],
    echo: 'Levels compare the portfolio’s tail loss with an equal-risk benchmark using the same holdings. This is an analytical comparison, not an allocation recommendation. If the benchmark cannot be computed, Levels stay unavailable.' },
  { id: 'panic', label: 'Panic game', short: 'Rehearse a calm choice', icon: Gauge, group: '#resilience-lab', groupLabel: 'Levels & rehearsal',
    result: ['[data-testid="section-panic-game"]'],
    echo: 'Set a hypothetical rupee loss limit, see how simulated losses compare, then pause for reflection. This changes neither your holdings nor your Levels. No real trades happen here.' },
  { id: 'card', label: 'Crash Card', short: 'A note to future you', icon: Layers, group: '#resilience-lab', groupLabel: 'Levels & rehearsal',
    result: ['[data-testid="section-crash-card"]'],
    echo: 'The Crash Card is a short note you can copy and keep for a rough day. It stays in this session only.' },
];

const intakeSelector = '.holdings-panel';
const intakeGuidance = 'This tool needs portfolio setup first. Choose Portfolio, add your holdings, then review, confirm and inspect them. Run each tool from its own panel.';
const groupGuidance = 'This station has not produced a result yet. You are at its panel: run it there when you are ready. Navigation never starts an analysis.';

type Status = 'result' | 'panel' | 'locked';

function findStatus(f: Feature): { el: Element | null; status: Status } {
  for (const sel of f.result) { const el = document.querySelector(sel); if (el) return { el, status: 'result' }; }
  const group = document.querySelector(f.group);
  if (group) return { el: group, status: 'panel' };
  return { el: document.querySelector(intakeSelector), status: 'locked' };
}

function Mark() {
  return <span className="shell-mark" aria-hidden="true"><span /><span /><span /><span /></span>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<FeatureId>('home');
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [note, setNote] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const next: Record<string, Status> = {};
    features.forEach((f) => { next[f.id] = findStatus(f).status; });
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

  const go = (id: FeatureId) => {
    setActive(id);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
    if (id === 'home') {
      setNote('');
      document.querySelector(intakeSelector)?.scrollIntoView({ behavior, block: 'start' });
      return;
    }
    const f = features.find((x) => x.id === id);
    if (!f) return;
    const { el, status } = findStatus(f);
    setNote(status === 'result' ? '' : status === 'panel' ? groupGuidance : intakeGuidance);
    const target = status === 'locked' ? document.querySelector('.shell-echo') : el;
    target?.scrollIntoView({ behavior, block: 'start' });
  };

  const current = features.find((f) => f.id === active);
  const echoLine = current ? current.echo : homeEcho;
  const groups = ['Replay & risk', 'Stress & simulation', 'Levels & rehearsal'];

  return <div className="shell">
    <a href="#shell-stage" className="shell-skip">Skip to workspace</a>
    <header className="shell-top">
      <a href="#shell-stage" onClick={(event) => { event.preventDefault(); go('home'); }} className="shell-brand" aria-label="Echo Fleet by VoltArena, home">
        <Mark />
        <span className="shell-brand-text"><b>Echo Fleet</b><small>by VoltArena</small></span>
      </a>
      <div className="shell-top-flags">
        <span className="shell-flag orange"><Sparkles size={12} /> 2090 is fictional</span>
        <span className="shell-flag"><ShieldCheck size={12} /> Holdings: session only</span>
      </div>
    </header>

    <nav className="shell-nav" aria-label="Echo Fleet stations">
      <button type="button" className={`shell-home ${active === 'home' ? 'is-active' : ''}`} aria-current={active === 'home' ? 'true' : undefined} onClick={() => go('home')} data-testid="nav-portfolio">
        <Home size={15} /><span><b>Portfolio</b><small>Start here</small></span>
      </button>
      <div className="shell-nav-scroll">
        {groups.map((g) => <div className="shell-group" key={g} role="group" aria-label={g}>
          <span className="shell-group-label">{g}</span>
          <div className="shell-group-items">
            {features.filter((f) => f.groupLabel === g).map((f) => {
              const Icon = f.icon;
              const st = statuses[f.id] ?? 'locked';
              const stLabel = st === 'result' ? 'result shown' : st === 'panel' ? 'ready to run' : 'needs inspection first';
              return <button type="button" key={f.id}
                className={`shell-item st-${st} ${active === f.id ? 'is-active' : ''}`}
                aria-current={active === f.id ? 'true' : undefined}
                aria-label={`${f.label}, ${stLabel}`}
                title={`${f.short} — ${stLabel}`}
                onClick={() => go(f.id)} data-testid={`nav-${f.id}`}>
                <Icon size={14} /><span>{f.label}</span><i className="shell-dot" aria-hidden="true" />
              </button>;
            })}
          </div>
        </div>)}
      </div>
    </nav>

    <section className="shell-console" aria-label="Echo guide">
      <div className="shell-echo">
        <div className="shell-echo-face" aria-hidden="true"><Radar size={20} /></div>
        <div className="shell-echo-body">
          <div className="shell-echo-head"><b>Echo</b><span>fixed guide text</span></div>
          <p key={active} className="shell-echo-line" data-testid="text-echo-guidance">{echoLine}</p>
          {note && <p className="shell-echo-note" role="status" data-testid="text-echo-nav-note"><LifeBuoy size={13} /> {note}</p>}
        </div>
      </div>
      <div className="shell-legend">
        <h1>Crash drills for the year <em>2090</em>.</h1>
        <p>A friendly, fictional crash simulator for exploring risk in Indian stocks and ETFs. It does not predict crashes, place trades or give advice.</p>
        <dl className="shell-kinds">
          <div><dt className="k-obs">Observed</dt><dd>Prices reported by Yahoo Finance, a limited prototype source. Missing prices stay missing.</dd></div>
          <div><dt className="k-proxy">Proxy</dt><dd>Clearly labeled sector-index history for stock gaps only. Never used for ETFs.</dd></div>
          <div><dt className="k-sim">Simulated</dt><dd>What-if shocks and paths, not observed prices. Past replay of current holdings is hypothetical.</dd></div>
        </dl>
      </div>
    </section>

    <div className="shell-stage" id="shell-stage" ref={stageRef} tabIndex={-1}>{children}</div>

    <footer className="shell-foot">
      <span className="shell-foot-brand"><Mark /> Echo Fleet by VoltArena</span>
      <p><Activity size={12} /> Fictional 2090 setting. Educational only: no predictions, no real trades, no advice. Holdings live in this session only.</p>
    </footer>
  </div>;
}
