import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  Info,
  LoaderCircle,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import { useAnalyzePortfolioRisk } from '@workspace/api-client-react';
import type {
  PortfolioHolding,
  PortfolioRiskAnalysisReport,
  ReplayWindowResult,
  RiskInstrumentCoverage,
} from '@workspace/api-client-react';

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'The risk analysis request could not be completed. Please try again.';
}

function StatusTag({ value }: { value: string }) {
  return <span className={`risk-status risk-status-${value.replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>;
}

function CoverageBadge({ item }: { item: RiskInstrumentCoverage }) {
  const label = item.dataType === 'observed'
    ? 'Observed history'
    : item.dataType === 'proxy'
      ? 'Proxy history'
      : 'Insufficient history';
  return <div className={`risk-provenance risk-provenance-${item.dataType}`}>
    <span className="risk-provenance-label">{label}</span>
    <strong>{item.ticker} <small>{item.instrumentType.toUpperCase()}</small></strong>
    <span className="risk-provenance-source">
      {item.sourceSymbol ? `Source: ${item.sourceSymbol}` : 'Source symbol not reported'}
      {item.proxyInstrument ? ` · Proxy: ${item.proxyInstrument}` : ''}
    </span>
    <span className="risk-provenance-dates">
      {item.coverageStart && item.coverageEnd
        ? `${item.coverageStart} — ${item.coverageEnd}`
        : 'Coverage dates not reported'}
      {' · '}{item.observationCount} observations
      {' · '}{item.missingAlignedObservations} missing aligned observations
    </span>
    <p>{item.note}</p>
  </div>;
}

function ReplayWindow({ window }: { window: ReplayWindowResult }) {
  const [expanded, setExpanded] = useState(false);
  const recoveryText = window.recoveryStatus === 'not_recovered'
    ? 'Not recovered in available history'
    : window.recoveryStatus.replaceAll('_', ' ');

  return <article className="risk-window" data-testid={`risk-window-${window.id}`}>
    <button className="risk-window-toggle" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} data-testid={`button-toggle-risk-window-${window.id}`}>
      <span className="risk-window-number mono">{window.id}</span>
      <span className="risk-window-title"><strong>{window.name}</strong><small>{window.startDate} — {window.endDate}</small></span>
      <StatusTag value={window.status} />
      <ChevronDown className={expanded ? 'risk-chevron is-open' : 'risk-chevron'} size={17} />
    </button>
    <div className="risk-window-snapshot">
      <div><span>MAX DRAWDOWN</span><b>{window.maxDrawdownPct === null ? 'Not available' : `${window.maxDrawdownPct}%`}</b></div>
      <div><span>RECOVERY</span><b>{recoveryText}</b></div>
      <div><span>OBSERVATIONS</span><b>{window.observationCount}</b></div>
    </div>
    {expanded && <div className="risk-window-details">
      <div className="risk-metrics">
        <RiskMetric label="Coverage start" value={window.coverageStart ?? 'Not reported'} />
        <RiskMetric label="Coverage end" value={window.coverageEnd ?? 'Not reported'} />
        <RiskMetric label="Peak portfolio value (INR)" value={window.peakValue === null ? 'Not available' : String(window.peakValue)} />
        <RiskMetric label="Trough portfolio value (INR)" value={window.troughValue === null ? 'Not available' : String(window.troughValue)} />
        <RiskMetric label="Trough date" value={window.troughDate ?? 'Not available'} />
        <RiskMetric label="Recovery trading days" value={window.recoveryTradingDays === null ? 'Not available' : String(window.recoveryTradingDays)} />
        <RiskMetric label="Recovery date" value={window.recoveryDate ?? 'Not available'} />
      </div>
      {window.recoveryStatus === 'not_recovered' && <p className="risk-recovery-note" role="note">
        <Info size={15} /> Not recovered in available history means the portfolio did not return to its previous peak within the history available for this replay window.
      </p>}
      {window.path.length > 0 ? <div className="risk-path">
        <div className="risk-subheading"><Activity size={14} /><strong>Python-computed replay path</strong><span>{window.path.length} points</span></div>
        <div className="risk-table-scroll"><table className="risk-table" data-testid={`table-replay-path-${window.id}`}>
          <thead><tr><th>Date</th><th>Portfolio value (INR)</th><th>Normalized value index</th></tr></thead>
          <tbody>{window.path.map((point, index) => <tr key={`${point.date}-${index}`}><td className="mono">{point.date}</td><td className="mono">{String(point.portfolioValue)}</td><td className="mono">{String(point.normalizedValueIndex)}</td></tr>)}</tbody>
        </table></div>
      </div> : <div className="risk-no-data">No replay path was returned for this window.</div>}
      <CoverageList items={window.instruments} title="Instrument history & provenance" />
      <NotesList notes={window.notes} title="Replay notes" />
    </div>}
  </article>;
}

function RiskMetric({ label, value }: { label: string; value: string }) {
  return <div className="risk-metric"><span>{label}</span><b>{value}</b></div>;
}

function CoverageList({ items, title }: { items: RiskInstrumentCoverage[]; title: string }) {
  return <section className="risk-coverage">
    <div className="risk-subheading"><ShieldCheck size={14} /><strong>{title}</strong><span>{items.length}</span></div>
    {items.length ? <div className="risk-coverage-grid">{items.map((item, index) => <CoverageBadge key={`${item.ticker}-${index}`} item={item} />)}</div> : <p className="risk-no-data">No per-instrument coverage details were returned.</p>}
  </section>;
}

function NotesList({ notes, title }: { notes: string[]; title: string }) {
  return <section className="risk-notes">
    <div className="risk-subheading"><Info size={14} /><strong>{title}</strong></div>
    {notes.length ? <ul>{notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul> : <p>No notes were returned.</p>}
  </section>;
}

function RiskReport({ report }: { report: PortfolioRiskAnalysisReport }) {
  const contribution = report.riskContribution;
  return <div className="risk-report" data-testid="risk-analysis-report">
    <div className="risk-report-meta">
      <div><span>ANALYSIS SOURCE</span><b>{report.source}</b></div>
      <div><span>CHECKED AT</span><b>{report.checkedAt}</b></div>
    </div>
    <div className="risk-section-intro">
      <div><div className="risk-kicker">01 / HISTORICAL REPLAY</div><h3>Stress windows, as observed.</h3></div>
      <p>Each replay uses the returned history and per-instrument provenance. Missing metrics remain unavailable rather than estimated.</p>
    </div>
    {report.replayWindows.length ? <div className="risk-window-list">{report.replayWindows.map((window) => <ReplayWindow key={window.id} window={window} />)}</div> : <div className="risk-no-data">No replay windows were returned by the analysis service.</div>}

    <section className="risk-contribution" data-testid="risk-contribution">
      <div className="risk-section-intro">
        <div><div className="risk-kicker">02 / RISK CONTRIBUTION</div><h3>How risk is distributed.</h3></div>
        <StatusTag value={contribution.status} />
      </div>
      <p className="risk-explanation">{contribution.explanation || 'No explanation was returned.'}</p>
      <div className="risk-contribution-summary">
        <RiskMetric label="Overlap start" value={contribution.coverageStart ?? 'Not reported'} />
        <RiskMetric label="Overlap end" value={contribution.coverageEnd ?? 'Not reported'} />
        <RiskMetric label="Aligned observations" value={String(contribution.observationCount)} />
        <RiskMetric label="Annualized volatility" value={contribution.annualizedVolatilityPct === null ? 'Not available' : `${contribution.annualizedVolatilityPct}%`} />
      </div>
      {contribution.contributions.length ? <div className="risk-table-scroll">
        <table className="risk-table" data-testid="table-risk-contributions">
          <thead><tr><th>Instrument</th><th>Latest weight</th><th>Annualized contribution</th><th>Contribution</th></tr></thead>
          <tbody>{contribution.contributions.map((item, index) => <tr key={`${item.ticker}-${index}`}>
            <td><strong>{item.ticker}</strong><small className="risk-instrument-type">{item.instrumentType.toUpperCase()}</small></td>
            <td className="mono">{item.latestWeightPct}%</td>
            <td className="mono">{item.annualizedContributionPct}%</td>
            <td className="mono">{item.contributionPct}%</td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="risk-no-data">No per-instrument contribution figures were returned.</div>}
      <CoverageList items={contribution.instruments} title="Contribution coverage & provenance" />
      <NotesList notes={contribution.notes} title="Contribution notes" />
    </section>

    <NotesList notes={report.methodNotes} title="Method notes" />
    <p className="risk-disclaimer"><Info size={14} /> Figures and replay paths are returned by the analysis service. Portfolio value is an adjusted-close replay, not an account statement.</p>
  </div>;
}

export function RiskAnalysis({ holdings, confirmed }: { holdings: PortfolioHolding[]; confirmed: boolean }) {
  const analysis = useAnalyzePortfolioRisk();
  const [result, setResult] = useState<PortfolioRiskAnalysisReport>();
  const [error, setError] = useState('');

  const requestAnalysis = () => {
    if (!confirmed || holdings.length === 0 || analysis.isPending) return;
    setError('');
    setResult(undefined);
    analysis.mutate({ data: { holdings } }, {
      onSuccess: (response) => setResult(response),
      onError: (reason) => setError(getErrorMessage(reason)),
    });
  };

  if (!confirmed || holdings.length === 0) return null;

  return <section className="risk-analysis-section enter" id="risk-analysis" aria-busy={analysis.isPending} data-testid="section-risk-analysis">
    <div className="risk-analysis-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule" /> STAGE 02 / REPLAY &amp; RISK</div>
        <h2>Stress-test the <em>history.</em></h2>
        <p>Run Python-computed event replays and risk contribution for the holdings you confirmed. Nothing is retained after this session.</p>
      </div>
      <span className="risk-session-mark"><ShieldCheck size={14} /> SESSION ONLY</span>
    </div>
    {!result && <div className="risk-request-card">
      <div className="risk-request-icon"><Activity size={20} /></div>
      <div className="risk-request-copy"><strong>Replay the confirmed portfolio</strong><p>Requests historical windows, coverage provenance, recovery status, and contribution figures. No calculations are performed in the browser.</p></div>
      <button className="button-primary risk-request-button" onClick={requestAnalysis} disabled={analysis.isPending} data-testid="button-analyze-risk">
        {analysis.isPending ? <><LoaderCircle className="spin" size={15} /> Analyzing history…</> : <><span>Analyze portfolio risk</span><RotateCw size={15} /> </>}
      </button>
    </div>}
    {analysis.isPending && <div className="risk-loading" role="status" aria-live="polite">
      <span className="risk-loading-bars"><i /><i /><i /><i /></span>
      <div><strong>Replaying market history</strong><p>Python is retrieving source history and calculating the returned figures.</p></div>
    </div>}
    {error && <div className="risk-error" role="alert"><AlertCircle size={17} /><div><strong>Risk analysis could not be completed</strong><p>{error}</p></div><button onClick={requestAnalysis} disabled={analysis.isPending} data-testid="button-retry-risk">{analysis.isPending ? 'Retrying…' : 'Try again'} <RotateCw size={13} /></button></div>}
    {result && <>
      <div className="risk-result-title"><div><Check size={15} /><span>ANALYSIS RETURNED</span></div><button className="button-outline" onClick={requestAnalysis} disabled={analysis.isPending} data-testid="button-refresh-risk">{analysis.isPending ? <LoaderCircle className="spin" size={14} /> : <RotateCw size={14} />} Run again</button></div>
      <RiskReport report={result} />
    </>}
  </section>;
}
