import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  BadgeCheck, BarChart3, ClipboardCheck, CloudLightning, CloudUpload, FlaskConical, LayoutDashboard,
  LoaderCircle, Lock, Pencil, Plus, Radar, Siren, TrendingUp, User, X,
} from 'lucide-react';
import {
  useGetMarketDataUniverse,
  useValidatePortfolioInput,
  useInspectPortfolioMarketData,
  useAnalyzePortfolioResilience,
} from '@workspace/api-client-react';
import type {
  Exchange, InstrumentType, PortfolioInspectReport, ResilienceReport, CsvPreviewReport, PortfolioInputIssue, InstrumentMarketReport, ValuedHolding,
} from '@workspace/api-client-react';
import { CrashAnalytics } from './crash-analytics';
import { RiskLab } from './risk-lab';
import { Simulator } from './simulator';
import { ReportPage } from './report-page';
import { previewCsvLocally } from './csv-preview';
import demoCsv from '../assets/demo-portfolio.csv?raw';
import './portfolio-page.css';

type StationId = 'portfolio' | 'crash' | 'risklab' | 'simulator' | 'report';
type Tab = 'manual' | 'csv' | 'sample';
type FieldKey = 'ticker' | 'exchange' | 'instrumentType' | 'quantity';
type Holding = { rowId: string; ticker: string; exchange: Exchange; instrumentType: InstrumentType; quantity: string; purchasePrice?: string; sourceName?: string };

const stations: { id: StationId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'portfolio', label: 'Portfolio', icon: LayoutDashboard },
  { id: 'crash', label: 'Crash Analytics', icon: CloudLightning },
  { id: 'risklab', label: 'Risk Lab', icon: FlaskConical },
  { id: 'simulator', label: 'Simulator', icon: Siren },
  { id: 'report', label: 'Reports', icon: ClipboardCheck },
];
const stationIds = stations.map((s) => s.id);
const readHash = (): StationId => {
  const h = window.location.hash.replace(/^#/, '') as StationId;
  return stationIds.includes(h) ? h : 'portfolio';
};

const fieldNames: Record<FieldKey, string> = { ticker: 'Ticker', exchange: 'Exchange', instrumentType: 'Type', quantity: 'Quantity' };
const emptyMap: Record<FieldKey, string> = { ticker: '', exchange: '', instrumentType: '', quantity: '' };
const tickerRe = /^[A-Z0-9][A-Z0-9.&_-]{0,19}$/;
const nodeSlots = ['n1', 'n2', 'n3', 'n4'];
type Milestone = 'inspect' | 'crash' | 'risk' | 'rehearsal' | 'report';
const milestoneList: { id: Milestone; label: string }[] = [
  { id: 'inspect', label: 'Portfolio confirmed and price history inspected' },
  { id: 'crash', label: 'Crash replay analysed with at least one available window' },
  { id: 'risk', label: 'Risk Lab returned an available stress, simulation or contributor result' },
  { id: 'rehearsal', label: 'Simulator rehearsal revealed' },
  { id: 'report', label: 'Report viewed with an analysis-service result' },
];
const inrFmt = (v: number | null | undefined) => v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pctFmt = (v: number) => `${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something interrupted the request. Please try again.';
}

function Modal({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: ReactNode }) {
  return <div className="pf-modal-wrap" role="dialog" aria-modal="true" aria-label={title}>
    <button type="button" className="pf-scrim" aria-label="Close" onClick={onClose} />
    <div className="pf-modal">
      <div className="pf-card-head"><div><div className="pf-kicker">{kicker}</div><h3 className="pf-h-md">{title}</h3></div>
        <button type="button" className="pf-icon-btn" onClick={onClose} aria-label="Close" data-testid="button-close-modal"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

export default function PortfolioPage() {
  const [station, setStation] = useState<StationId>(readHash);
  const universe = useGetMarketDataUniverse();
  const validate = useValidatePortfolioInput();
  const inspect = useInspectPortfolioMarketData();
  const levelRun = useAnalyzePortfolioResilience();
  const levelReq = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRevision = useRef(0);

  const [tab, setTab] = useState<Tab>('manual');
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [exchange, setExchange] = useState<Exchange>('NSE');
  const [instrumentType, setInstrumentType] = useState<InstrumentType>('stock');
  const [manualError, setManualError] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvPreviewReport>();
  const [csvName, setCsvName] = useState('');
  const [csvReading, setCsvReading] = useState(false);
  const csvReadRevision = useRef(0);
  const [csvError, setCsvError] = useState('');
  const [csvNotice, setCsvNotice] = useState('');
  const [columnMap, setColumnMap] = useState<Record<FieldKey, string>>(emptyMap);
  const [dragging, setDragging] = useState(false);
  const [sampleRowId, setSampleRowId] = useState<string>();
  const [sampleError, setSampleError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [issues, setIssues] = useState<PortfolioInputIssue[]>([]);
  const [validationError, setValidationError] = useState('');
  const [report, setReport] = useState<PortfolioInspectReport>();
  const [reportError, setReportError] = useState('');
  const [filter, setFilter] = useState('');
  const [openRow, setOpenRow] = useState<string>();
  const [resilience, setResilience] = useState<{ key: string; result: ResilienceReport }>();
  const inspectionKeyRef = useRef<string | undefined>(undefined);
  inspectionKeyRef.current = report?.checkedAt;
  const publishResilience = (key: string | undefined) => (r: ResilienceReport | undefined) => {
    if (!key || key !== inspectionKeyRef.current) return;
    setResilience(r ? { key, result: r } : undefined);
  };
  const sessionResilience = resilience && resilience.key === report?.checkedAt ? resilience.result : undefined;
  const [editingId, setEditingId] = useState<string>();
  const [levelError, setLevelError] = useState('');
  const [milestones, setMilestones] = useState<{ key: string; done: Milestone[] }>();
  const mark = (key: string | undefined) => (m: Milestone) => {
    if (!key || key !== inspectionKeyRef.current) return;
    setMilestones((cur) => cur && cur.key === key ? (cur.done.includes(m) ? cur : { key, done: [...cur.done, m] }) : { key, done: [m] });
  };

  useEffect(() => {
    const on = () => setStation(readHash());
    window.addEventListener('hashchange', on); window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  const go = (id: StationId) => { setStation(id); if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`); };

  const configured = universe.data?.instruments ?? [];
  const sampleLoaded = holdings.some((h) => h.rowId === sampleRowId);

  const invalidate = () => { inputRevision.current += 1; levelReq.current += 1; setLevelError(''); setMilestones(undefined); setResilience(undefined); setReport(undefined); setReportError(''); setShowConfirm(false); setIssues([]); setValidationError(''); };

  const addManual = () => {
    if (inspect.isPending) return;
    let t = symbol.trim().toUpperCase();
    let ex = exchange;
    if (t.endsWith('.NS')) { t = t.slice(0, -3); ex = 'NSE'; } else if (t.endsWith('.BO')) { t = t.slice(0, -3); ex = 'BSE'; }
    const qty = Number(quantity);
    if (!tickerRe.test(t) || !Number.isFinite(qty) || qty <= 0) { setManualError('Enter a valid symbol and a positive quantity.'); return; }
    if (price.trim() && (!Number.isFinite(Number(price)) || Number(price) < 0)) { setManualError('Purchase price must be a finite positive number or zero, or leave it blank.'); return; }
    if (!editingId && holdings.length >= 50) { setManualError('A session supports at most 50 holdings.'); return; }
    if (holdings.some((h) => h.rowId !== editingId && h.ticker === t && h.exchange === ex)) { setManualError(`${t} on ${ex} is already in this session.`); return; }
    setManualError('');
    const next = { ticker: t, exchange: ex, instrumentType, quantity: quantity.trim(), purchasePrice: price.trim() || undefined };
    if (editingId) {
      if (!holdings.some((h) => h.rowId === editingId)) { setManualError('That holding is no longer in this session.'); setEditingId(undefined); return; }
      setHoldings((cur) => cur.map((h) => h.rowId === editingId ? { ...h, ...next } : h));
      if (editingId === sampleRowId) setSampleRowId(undefined);
      setEditingId(undefined);
    } else setHoldings((cur) => [...cur, { rowId: crypto.randomUUID(), ...next }]);
    setSymbol(''); setQuantity(''); setPrice('');
    invalidate();
  };

  const startEdit = (rowId: string) => {
    if (inspect.isPending) return;
    const h = holdings.find((x) => x.rowId === rowId); if (!h) return;
    setEditingId(rowId); setTab('manual'); setManualError('');
    setSymbol(h.ticker); setExchange(h.exchange); setInstrumentType(h.instrumentType); setQuantity(h.quantity); setPrice(h.purchasePrice ?? '');
  };
  const cancelEdit = () => { setEditingId(undefined); setSymbol(''); setQuantity(''); setPrice(''); setManualError(''); };
  const removeHolding = (rowId: string) => {
    if (inspect.isPending) return;
    if (rowId === editingId) cancelEdit();
    setHoldings((items) => items.filter((h) => h.rowId !== rowId));
    if (rowId === sampleRowId) setSampleRowId(undefined);
    invalidate();
  };
  const clearAll = () => { if (inspect.isPending) return; cancelEdit(); setHoldings([]); setSampleRowId(undefined); invalidate(); inspect.reset(); validate.reset(); };

  // CSV
  const csvHeaders = csvPreview?.columns ?? [];
  const csvRows = csvPreview?.rows ?? [];
  const mapped = useMemo(() => {
    const seen = new Set(holdings.map((h) => `${h.exchange}:${h.ticker}`));
    return csvRows.map((record) => {
      const val = (f: FieldKey) => { const i = csvHeaders.indexOf(columnMap[f]); return i < 0 ? '' : (record.cells[i] ?? '').trim(); };
      const tk = val('ticker').toUpperCase();
      const exRaw = val('exchange').toUpperCase();
      const qText = val('quantity');
      const qty = Number(qText.replace(/,/g, ''));
      const qFormatted = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/.test(qText) || /^\.\d+$/.test(qText);
      const exValid = exRaw === 'NSE' || exRaw === 'BSE';
      const typeRaw = val('instrumentType').toLowerCase();
      const typeValid = !columnMap.instrumentType || typeRaw === 'stock' || typeRaw === 'etf';
      const errors: string[] = [];
      if (!columnMap.ticker) errors.push('Choose the Ticker column.');
      else if (!tk) errors.push('Enter a ticker.');
      else if (!tickerRe.test(tk)) errors.push('Ticker uses unsupported characters.');
      if (!columnMap.quantity) errors.push('Choose the Quantity column.');
      else if (!qText) errors.push('Enter a quantity.');
      else if (!qFormatted) errors.push('Use a number; commas must separate thousands.');
      else if (!Number.isFinite(qty) || qty <= 0) errors.push('Quantity must be greater than zero.');
      if (columnMap.exchange && !exValid) errors.push('Exchange must be NSE or BSE.');
      if (!typeValid) errors.push('Type must be stock or ETF.');
      const ex = (!columnMap.exchange ? 'NSE' : exValid ? exRaw : '—') as Exchange | '—';
      const ty = (!columnMap.instrumentType ? 'stock' : typeValid ? (typeRaw === 'etf' ? 'etf' : 'stock') : '—') as InstrumentType | '—';
      if (tk && ex !== '—' && tickerRe.test(tk)) {
        const key = `${ex}:${tk}`;
        if (seen.has(key)) errors.push('Already in your session or earlier in this CSV.'); else seen.add(key);
      }
      return { rowNumber: record.rowNumber, ticker: tk, exchange: ex, instrumentType: ty, quantity: qText, errors, valid: errors.length === 0 };
    });
  }, [csvRows, csvHeaders, columnMap, holdings]);
  const readyRows = mapped.filter((r) => r.valid);
  const countMatches = !!csvPreview && Number.isFinite(csvPreview.rowCount) && csvPreview.rowCount === csvRows.length;
  const overLimit = holdings.length + csvRows.length > 50;
  const canAddCsv = countMatches && readyRows.length > 0 && readyRows.length === csvRows.length && !overLimit && !inspect.isPending;

  const requestCsvPreview = (text: string) => {
    setCsvError('');
    try {
      const parsed = previewCsvLocally(text);
      setCsvPreview(parsed);
      const s = parsed.suggestedMapping;
      setColumnMap({ ticker: s.tickerColumn ?? '', exchange: s.exchangeColumn ?? '', instrumentType: s.instrumentTypeColumn ?? '', quantity: s.quantityColumn ?? '' });
    } catch (error) {
      setCsvPreview(undefined);
      setCsvError(`We could not preview this CSV. ${errorMessage(error)} No rows were added.`);
    }
  };

  const readFile = (file: File) => {
    const readId = ++csvReadRevision.current;
    setCsvReading(false); setCsvPreview(undefined);
    if (file.size > 80_000) { setCsvError('This CSV is over the 80 KB limit. No rows were added.'); return; }
    setCsvName(file.name); setCsvError(''); setCsvNotice(''); setCsvPreview(undefined);
    setCsvReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (readId !== csvReadRevision.current) return;
      setCsvReading(false);
      const text = String(reader.result ?? '');
      requestCsvPreview(text);
    };
    reader.onerror = reader.onabort = () => {
      if (readId !== csvReadRevision.current) return;
      setCsvReading(false); setCsvError('We could not read this file. No rows were added.');
    };
    reader.readAsText(file);
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; };
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); };
  const closeCsv = () => { csvReadRevision.current++; setCsvReading(false); setCsvPreview(undefined); setCsvName(''); };
  const addCsvRows = () => {
    if (!canAddCsv) return;
    setHoldings((cur) => [...cur, ...readyRows.map((r) => ({ rowId: crypto.randomUUID(), ticker: r.ticker, exchange: r.exchange as Exchange, instrumentType: r.instrumentType as InstrumentType, quantity: r.quantity, sourceName: csvName }))]);
    setCsvNotice(`${readyRows.length} ${readyRows.length === 1 ? 'row' : 'rows'} added to this session.`);
    closeCsv(); setCsvError(''); invalidate();
  };

  const loadSample = () => {
    setSampleError('');
    if (inspect.isPending || csvReading || csvPreview) { setSampleError('Finish the current inspection or CSV review first.'); return; }
    if (holdings.length) { setSampleError('Clear current holdings first; existing rows are never replaced.'); return; }
    setCsvName('demo-portfolio.csv');
    requestCsvPreview(demoCsv);
  };
  const downloadDemoCsv = () => {
    const url = URL.createObjectURL(new Blob([demoCsv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'demo-portfolio.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const apiHoldings = holdings.map((h) => ({ ticker: h.ticker, exchange: h.exchange, instrumentType: h.instrumentType, quantity: String(h.quantity) }));
  const canReview = holdings.length > 0 && holdings.length <= 50 && !inspect.isPending && !validate.isPending;
  const beginReview = () => {
    if (!canReview) return;
    const revision = inputRevision.current;
    setIssues([]); setValidationError('');
    validate.mutate({ data: { holdings: apiHoldings } }, {
      onSuccess: (r) => { if (revision !== inputRevision.current) return; setIssues(r.issues); if (r.valid) setShowConfirm(true); },
      onError: (e) => { if (revision === inputRevision.current) setValidationError(errorMessage(e)); },
    });
  };
  const confirmInspect = () => {
    if (!holdings.length || inspect.isPending) return;
    const revision = inputRevision.current;
    levelReq.current += 1;
    setResilience(undefined); setMilestones(undefined); setLevelError('');
    setReport(undefined); setReportError('');
    inspect.mutate({ data: { holdings: apiHoldings } }, {
      onSuccess: (r) => { if (revision !== inputRevision.current) return; setReport(r); setShowConfirm(false); },
      onError: (e) => { if (revision !== inputRevision.current) return; setReportError(errorMessage(e)); setShowConfirm(false); },
    });
  };

  const valuation = report?.valuation;
  const valuedFor = (ticker: string, ex: string) => valuation?.holdings.find((v) => v.ticker === ticker && v.exchange === ex);
  const levels = sessionResilience?.levels;
  const levelText = levels?.status === 'available' && levels.level !== null ? `Investor Lvl ${levels.level}` : 'Investor Lvl —';
  const doneList: Milestone[] = [];
  if (report && report.instruments.some((i) => i.status === 'success')) doneList.push('inspect');
  if (milestones && milestones.key === report?.checkedAt) milestones.done.forEach((m) => { if (!doneList.includes(m)) doneList.push(m); });
  const doneCount = doneList.length;
  const badgeName = doneCount === 5 ? 'All five modules' : doneList.includes('rehearsal') ? 'Rehearsal completed' : doneList.includes('risk') ? 'Risk analysis completed' : doneList.includes('inspect') ? 'Portfolio inspected' : '';
  const calcLevel = () => {
    if (!report || !holdings.length || levelRun.isPending) return;
    const key = report.checkedAt; const id = ++levelReq.current;
    setLevelError('');
    levelRun.mutate({ data: { holdings: apiHoldings } }, {
      onSuccess: (r) => { if (id === levelReq.current) publishResilience(key)(r); },
      onError: (e) => { if (id === levelReq.current) setLevelError(errorMessage(e)); },
    });
  };
  const reportShown = station === 'report' && !!sessionResilience;
  const reportKey = report?.checkedAt;
  const markRef = useRef(mark); markRef.current = mark;
  useEffect(() => { if (reportShown) markRef.current(reportKey)('report'); }, [reportShown, reportKey]);

  // Price history rows: inspected report, else session holdings awaiting inspection
  type Row = { key: string; name: string; sub: string; source: string; range: string; status: string; tone: string; inst?: InstrumentMarketReport };
  const rows: Row[] = report
    ? report.instruments.map((i) => ({
      key: `${i.exchange}:${i.ticker}`, name: i.ticker, sub: i.yahooSymbol,
      source: i.dataType === 'proxy' && i.proxyInstrument ? `Proxy: ${i.proxyInstrument}` : report.source,
      range: i.coverageStart && i.coverageEnd ? `${i.coverageStart} – ${i.coverageEnd}` : '—',
      status: i.status === 'skipped' ? 'Skipped' : i.dataType === 'observed' ? 'Observed' : i.dataType === 'proxy' ? 'Proxy' : 'Insufficient',
      tone: i.status === 'skipped' || i.dataType === 'insufficient' ? 'err' : i.dataType === 'proxy' ? 'pri' : 'sec', inst: i,
    }))
    : holdings.map((h) => ({ key: `${h.exchange}:${h.ticker}`, name: h.ticker, sub: `${h.exchange} · ${h.instrumentType.toUpperCase()}`, source: '—', range: '—', status: 'Not inspected', tone: 'mute' }));
  const shown = rows.filter((r) => `${r.name} ${r.sub}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const exportRows = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [['Asset', 'Symbol', 'Data source', 'Available date range', 'Data status', 'Observations', 'Missing adjusted closes', 'Quantity', 'Raw close (INR)', 'Value (INR)', 'Weight %', 'Price date', 'Valuation note'].map(esc).join(',')];
    rows.forEach((r) => { const v = r.inst ? valuedFor(r.inst.ticker, r.inst.exchange) : undefined;
      lines.push([r.name, r.sub, r.source, r.range, r.status, r.inst ? String(r.inst.observationCount) : '', r.inst ? String(r.inst.missingAdjustedCloseCount) : '', v ? String(v.quantity) : '', v?.priceInr != null ? String(v.priceInr) : '', v?.valueInr != null ? String(v.valueInr) : '', v?.weightPct != null ? String(v.weightPct) : '', v?.asOfDate ?? '', v?.reason ?? ''].map(esc).join(',')); });
    if (report) {
      lines.push('');
      lines.push(['Portfolio valuation status', valuation?.status ?? 'not returned'].map(esc).join(','));
      lines.push(['Total value (INR)', valuation?.totalValueInr != null ? String(valuation.totalValueInr) : 'unavailable'].map(esc).join(','));
      lines.push(['Common raw close date', valuation?.asOfDate ?? ''].map(esc).join(','));
      if (valuation?.reason) lines.push(['Reason', valuation.reason].map(esc).join(','));
      valuation?.allocations.forEach((a) => lines.push([`Allocation ${a.instrumentType}`, String(a.valueInr), `${a.weightPct}%`].map(esc).join(',')));
      [...(valuation?.notes ?? []), ...report.dataNotes].forEach((n) => lines.push(['Note', n].map(esc).join(',')));
      lines.push(['Source', `${report.source} (prototype, may be incomplete)`].map(esc).join(','));
      lines.push(['Checked at', report.checkedAt].map(esc).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'portfolio-data-report.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const feedLabel = universe.isLoading ? 'CHECKING' : universe.isError ? 'UNREACHABLE' : 'YAHOO // PROTOTYPE';
  const sysLabel = universe.isLoading ? 'SYS.CHECKING' : universe.isError ? 'SYS.OFFLINE' : 'SYS.ONLINE';
  const importedFiles = [...new Set(holdings.flatMap((holding) => holding.sourceName ? [holding.sourceName] : []))];
  const sharedPortfolio = <section className="pf-shared-portfolio" data-testid="panel-shared-portfolio">
    <div className="pf-shared-heading">
      <div><strong>{holdings.length ? `${holdings.length} holdings loaded from Portfolio` : 'Add holdings on Portfolio to begin'}</strong>
        <p>{holdings.length
          ? `${report ? 'Confirmed and inspected. ' : 'Confirmation and inspection needed on Portfolio. '}Every section uses these same session holdings. No additional CSV upload is needed.`
          : 'Upload a CSV or enter holdings once on Portfolio; Crash Analytics, Risk Lab, Simulator and Reports all use that same portfolio.'}</p>
        {importedFiles.length > 0 && <p data-testid="text-shared-csv-source">CSV source: {importedFiles.join(', ')}</p>}
      </div>
      <button type="button" className="pf-btn-quiet" onClick={() => go('portfolio')} data-testid="button-manage-shared-portfolio">{holdings.length ? 'Manage on Portfolio' : 'Go to Portfolio'}</button>
    </div>
    {holdings.length > 0 && <details><summary>View shared holdings</summary><div className="pf-table-wrap"><table className="pf-table"><thead><tr><th>Holding</th><th>Exchange</th><th>Type</th><th>Quantity entered</th></tr></thead><tbody>{holdings.map((holding) => <tr key={holding.rowId}><td>{holding.ticker}</td><td>{holding.exchange}</td><td>{holding.instrumentType}</td><td>{holding.quantity}</td></tr>)}</tbody></table></div></details>}
    <p className="pf-shared-note">Session-only: switching sections keeps your holdings. Refreshing or closing this tab clears them.</p>
  </section>;

  return <div className="pf-app">
    <aside className="pf-side">
      <div className="pf-brand"><TrendingUp size={24} /><div><b>VOLT_ARENA</b><small>PORTFOLIO INTELLIGENCE</small></div></div>
      <nav className="pf-nav">
        {stations.map((s) => { const Icon = s.icon; return <button type="button" key={s.id} className={station === s.id ? 'is-active' : ''} aria-current={station === s.id ? 'page' : undefined} onClick={() => go(s.id)} data-testid={`nav-${s.id}`}><Icon size={20} />{s.label}</button>; })}
      </nav>
      <div className="pf-feed"><div>MARKET DATA FEED</div><p><i className={universe.isError ? 'is-off' : ''} /> {feedLabel}</p></div>
    </aside>

    <div className="pf-body">
      <header className="pf-top">
        <span className="pf-sys" data-testid="text-sys-status">{sysLabel}</span>
        <div className="pf-user"><div><b data-testid="text-top-level">{levelText}</b><small>{doneCount} / 5 MODULES · SESSION</small></div><span><User size={18} /></span></div>
      </header>

      <main className="pf-main" hidden={station !== 'crash'}>
        {station === 'crash' && sharedPortfolio}
        <CrashAnalytics key={report?.checkedAt ?? 'none'} holdings={apiHoldings} inspectionKey={report?.checkedAt} onReturn={() => go('portfolio')} onCompleted={() => mark(report?.checkedAt)('crash')} />
      </main>
      <main className="pf-main" hidden={station !== 'risklab'}>
        {station === 'risklab' && sharedPortfolio}
        <RiskLab key={report?.checkedAt ?? 'none'} holdings={apiHoldings} inspectionKey={report?.checkedAt} onCompleted={() => mark(report?.checkedAt)('risk')} />
      </main>
      <main className="pf-main" hidden={station !== 'simulator'}>
        {station === 'simulator' && sharedPortfolio}
        <Simulator key={report?.checkedAt ?? 'none'} holdings={apiHoldings} inspectionKey={report?.checkedAt} snapshot={valuation} onResult={(r) => { publishResilience(report?.checkedAt)(r); if (r?.panicGame.status === 'revealed') mark(report?.checkedAt)('rehearsal'); }} />
      </main>
      <main className="pf-main pf-report-main" hidden={station !== 'report'}>
        {station === 'report' && sharedPortfolio}
        <ReportPage key={report?.checkedAt ?? 'none'} holdings={apiHoldings} inspectionKey={report?.checkedAt} result={sessionResilience} onResult={publishResilience(report?.checkedAt)} onReturn={() => go('portfolio')} />
      </main>
      {station === 'crash' || station === 'risklab' || station === 'simulator' || station === 'report' ? null : station !== 'portfolio' ? <main className="pf-main"><div className="pf-await" data-testid="panel-awaiting-design">
        <Radar size={18} /><div><b>Awaiting your next page design</b><p>{stations.find((s) => s.id === station)?.label}</p></div>
      </div></main> : <main className="pf-main">
        <div className="pf-tiles">
          <div className="pf-card pf-tile pf-glow">
            <div><div className="pf-label pri">Total Portfolio Value</div><div className="pf-h-lg" data-testid="text-total-value">{valuation?.status === 'complete' ? inrFmt(valuation.totalValueInr) : '—'}</div></div>
            <div className="pf-note sec"><TrendingUp size={16} /> {!report ? 'Confirm & Inspect to value holdings' : !valuation ? 'Valuation not returned by the analysis service' : valuation.status === 'complete' ? `Raw close, ${valuation.asOfDate ?? '—'} · ${report.source} prototype` : `Unavailable: ${valuation.reason ?? 'no common close date'}`}</div>
          </div>
          <div className="pf-card pf-tile">
            <div><div className="pf-label pri">Learning Progress</div><div className="pf-h-lg" data-testid="text-modules">{doneCount} / 5 Modules</div></div>
            <div className="pf-bar"><i style={{ width: `${doneCount * 20}%` }} /></div>
            <details className="pf-checklist"><summary>Session checklist</summary><ul>{milestoneList.map((m) => <li key={m.id} className={doneList.includes(m.id) ? 'is-done' : ''}>{doneList.includes(m.id) ? 'Done' : 'Open'}: {m.label}</li>)}</ul><p>Counted only from real results. Resets when holdings change or on a new inspection; refreshing the page resets the session.</p></details>
          </div>
          <div className="pf-card pf-tile pf-tile-row">
            <div><div className="pf-label sec">Investor Rank &amp; Badge</div><div className="pf-h-sm" data-testid="text-level">{levelText}{levels?.status === 'available' ? ` · ${levels.label}` : ''}</div>
              <span className="pf-chip" data-testid="text-badge">{badgeName || 'No badge yet'}</span>
              <div className="pf-level-act">
                {levels ? (levels.status === 'available' ? <small>Score {levels.scorePct ?? '—'}% · ratio {levels.ratioToPar ?? '—'}</small> : <small>Unavailable: {levels.reason}</small>)
                  : <button type="button" className="pf-link" onClick={calcLevel} disabled={!report || !holdings.length || levelRun.isPending} data-testid="button-calc-level">{levelRun.isPending ? 'Calculating…' : report ? 'Calculate Level' : 'Inspect first to calculate'}</button>}
                {levelError && <small className="pf-err-inline">{levelError} <button type="button" className="pf-link" onClick={calcLevel}>Retry</button></small>}
                <details className="pf-checklist"><summary>How level and badges work</summary><p>Level compares your simulated tail loss (CVaR) with a benchmark of the same holdings: long-only, fully invested, no leverage, equal component CVaR. Analytical comparison only, not an allocation recommendation.</p><p>Badges are session-only: Portfolio inspected, Risk analysis completed, Rehearsal completed, All five modules. They unlock only from real results and reset with holdings edits.</p></details>
              </div></div>
            <span className="pf-badge-ic"><BadgeCheck size={36} /></span>
          </div>
        </div>

        <div className="pf-grid">
          <div className="pf-left">
            <section className="pf-card pf-xl">
              <div className="pf-card-head">
                <div><div className="pf-kicker">PORTFOLIO ASSET INPUT</div><h2 className="pf-h-md">Add Holdings</h2></div>
                <div className="pf-tabs" role="tablist">
                  {(['manual', 'csv', 'sample'] as Tab[]).map((t) => <button type="button" role="tab" key={t} aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t === 'manual' ? 'Manual Add' : t === 'csv' ? 'CSV Upload' : 'Sample Portfolios'}</button>)}
                </div>
              </div>

              {tab === 'manual' && <div className="pf-manual">
                <div className="pf-fields">
                  <label><span>Stock / ETF Symbol</span><input value={symbol} onChange={(e) => setSymbol(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addManual(); }} placeholder="e.g. RELIANCE.NS" data-testid="input-ticker" /></label>
                  <label><span>Quantity</span><input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addManual(); }} placeholder="0" data-testid="input-quantity" /></label>
                  <label><span>Purchase Price (₹, optional, reference only)</span><input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" data-testid="input-purchase-price" /></label>
                </div>
                <div className="pf-manual-foot">
                  <div className="pf-mini-selects">
                    <select aria-label="Exchange" value={exchange} onChange={(e) => setExchange(e.target.value as Exchange)} data-testid="select-exchange"><option value="NSE">NSE</option><option value="BSE">BSE</option></select>
                    <select aria-label="Instrument type" value={instrumentType} onChange={(e) => setInstrumentType(e.target.value as InstrumentType)} data-testid="select-instrument-type"><option value="stock">Stock</option><option value="etf">ETF</option></select>
                  </div>
                  <div className="pf-mini-selects">{editingId && <button type="button" className="pf-btn-quiet" onClick={cancelEdit} data-testid="button-cancel-edit">Cancel</button>}
                  <button type="button" className="pf-btn-accent" onClick={addManual} disabled={inspect.isPending} data-testid="button-add-holding">{editingId ? <><Pencil size={18} /> Save Changes</> : <><Plus size={18} /> Add Asset</>}</button></div>
                </div>
                {manualError && <p className="pf-err" role="alert">{manualError}</p>}
                {editingId && <p className="pf-hint">Editing a holding. Saving clears inspection, values, level and progress until you confirm again. Purchase price is not used by the engine.</p>}
              </div>}

              {tab === 'csv' && <div>
                <div className={`pf-drop ${dragging ? 'is-drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }} data-testid="dropzone-csv">
                  {csvReading ? <LoaderCircle className="pf-spin" size={36} /> : <CloudUpload size={36} />}
                  <div className="pf-h-sm">{csvReading ? 'Reading your CSV…' : 'Drag & Drop Holdings CSV Here'}</div>
                  <div className="pf-body-sm">Supports .csv up to 80 KB. Previewed locally in this tab; Python validates before analysis.</div>
                  <span className="pf-btn-quiet">Browse Local Files</span>
                </div>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} hidden data-testid="input-csv-file" />
                {csvNotice && <p className="pf-ok" role="status">{csvNotice}</p>}
                {csvError && !csvPreview && <div className="pf-csv-error"><p className="pf-err" role="alert">{csvError}</p></div>}
                <button type="button" className="pf-link" onClick={downloadDemoCsv} data-testid="button-download-demo-csv">Download demo CSV</button>
                <p className="pf-hint">College demo: RELIANCE, TCS and INFY. Example quantities, not recommendations. Dated, real historical snapshots are bundled for these symbols; no live Yahoo connection is needed for their analysis.</p>
              </div>}

              {tab === 'sample' && <div className="pf-samples">
                <button type="button" className="pf-sample" onClick={loadSample} data-testid="button-demo-portfolio">
                  <div className="pf-h-sm">College demo portfolio</div>
                  <div className="pf-body-sm">Preview a built-in CSV: RELIANCE, TCS and INFY. Review and confirm before analysis.</div>
                  <div className="pf-label pri pf-mt">Dated historical snapshots · not live prices · not your holdings</div>
                </button>
                <button type="button" className="pf-link" onClick={downloadDemoCsv}>Download the same demo CSV</button>
                {sampleError && <p className="pf-err" role="alert">{sampleError}</p>}
              </div>}
            </section>

            <section className="pf-card pf-xl pf-summary">
              <div className="pf-card-head">
                <div><div className="pf-kicker sec">VALUATION OVERVIEW</div><h3 className="pf-h-md">Portfolio Valuation Summary</h3></div>
                <BarChart3 size={22} className="sec" />
              </div>
              <div className="pf-sum-grid">
                <div className="pf-inner">
                  <div className="pf-label mute">TOTAL VALUATION</div>
                  <div className="pf-h-lg pri" data-testid="text-summary-total">{valuation?.status === 'complete' ? inrFmt(valuation.totalValueInr) : '—'}</div>
                  <div className="pf-body-sm sec">{!report ? 'Confirm & Inspect to value holdings.' : !valuation ? 'Valuation not returned.' : valuation.status === 'complete' ? `Quantity × raw close on ${valuation.asOfDate ?? '—'} (latest common date). No proxies or fills. ${report.source} prototype.` : `Unavailable: ${valuation.reason ?? 'no common close date'}. No partial total shown.`}</div>
                </div>
                <div className="pf-inner pf-alloc">
                  <div className="pf-label mute">ASSET ALLOCATION</div>
                  <div className="pf-alloc-bar pf-alloc-split">{valuation?.allocations.map((a) => <i key={a.instrumentType} className={a.instrumentType} style={{ width: `${a.weightPct}%` }} />)}</div>
                  <div className="pf-label mute">{valuation?.allocations.length ? valuation.allocations.map((a) => `${a.instrumentType.toUpperCase()} ${pctFmt(a.weightPct)} (${inrFmt(a.valueInr)})`).join(' · ') : 'No weights returned'}</div>
                </div>
              </div>
              <div className="pf-sum-foot">
                <p><Lock size={16} className="sec" /><span>Holdings stay in this browser session; nothing is saved.</span></p>
                <button type="button" className="pf-btn-primary" onClick={beginReview} disabled={!canReview} data-testid="button-review-confirmation">
                  {validate.isPending ? <><LoaderCircle className="pf-spin" size={16} /> Checking</> : inspect.isPending ? <><LoaderCircle className="pf-spin" size={16} /> Inspecting</> : 'Confirm & Inspect'}
                </button>
              </div>
              {!holdings.length && <p className="pf-hint">Add at least one holding to inspect price history.</p>}
              {valuation?.notes.map((n) => <p key={n} className="pf-hint">{n}</p>)}
              {validationError && <p className="pf-err" role="alert">{validationError}</p>}
              {issues.length > 0 && <div className="pf-err" role="alert">{issues.map((i, n) => <p key={`${i.row}-${n}`}>Row {i.row}: {i.message}</p>)}</div>}
              {reportError && <p className="pf-err" role="alert">Inspection could not be completed. {reportError} <button type="button" className="pf-link" onClick={beginReview} data-testid="button-retry-inspection">Try again</button></p>}
            </section>
          </div>

          <section className="pf-card pf-xl pf-map" data-testid="panel-portfolio-view">
            <div className="pf-dots" aria-hidden="true" />
            <div className="pf-map-top">
              <div className="pf-card-head">
                <div><div className="pf-kicker">ASSET ALLOCATION MAP</div><h3 className="pf-h-md">Portfolio view</h3></div>
                <Radar size={22} className="pri pf-spin-slow" />
              </div>
              <p className="pf-body-sm mute">{holdings.length ? `${holdings.length} / 50 holdings in session. ${valuation?.status === 'complete' ? `Weights from raw close ${valuation.asOfDate}.` : 'Weights appear after a complete valuation.'} Use the pencil to edit.` : 'No holdings in this session yet.'}</p>
            </div>
            <div className="pf-orbit">
              <i className="r1" /><i className="r2" /><i className="r3" />
              <div className={`pf-core ${holdings.length ? '' : 'is-empty'}`}>CORE</div>
              {holdings.slice(0, 4).map((h, n) => <div key={h.rowId} className={`pf-node ${nodeSlots[n]}`} data-testid={`node-holding-${n}`}>
                <div className="pf-label">{h.ticker}{h.rowId === sampleRowId ? ' · SAMPLE' : ''}</div>
                <div className="pf-node-v">QTY {h.quantity}{(() => { const v = valuedFor(h.ticker, h.exchange); return v?.weightPct != null ? ` · ${pctFmt(v.weightPct)}` : ''; })()}</div>
                <button type="button" className="pf-node-ed" onClick={() => startEdit(h.rowId)} disabled={inspect.isPending} aria-label={`Edit ${h.ticker}`} data-testid={`button-edit-${n}`}><Pencil size={11} /></button>
                <button type="button" disabled={inspect.isPending} onClick={() => removeHolding(h.rowId)} aria-label={`Remove ${h.ticker}`} data-testid={`button-remove-${n}`}><X size={12} /></button>
              </div>)}
            </div>
            {holdings.length > 4 && <div className="pf-more">
              {holdings.slice(4).map((h, n) => <span key={h.rowId}>{h.ticker} <small>{h.quantity}</small><button type="button" onClick={() => startEdit(h.rowId)} disabled={inspect.isPending} aria-label={`Edit ${h.ticker}`} data-testid={`button-edit-${n + 4}`}><Pencil size={11} /></button><button type="button" disabled={inspect.isPending} onClick={() => removeHolding(h.rowId)} aria-label={`Remove ${h.ticker}`} data-testid={`button-remove-${n + 4}`}><X size={11} /></button></span>)}
            </div>}
            {sampleLoaded && <p className="pf-body-sm pri pf-sample-note" data-testid="text-sample-banner">Sample input: one VEDL share, not your holding and not a suggestion.</p>}
            <div className="pf-map-foot"><span>VALUE: {valuation?.status === 'complete' ? inrFmt(valuation.totalValueInr) : '—'}</span>{holdings.length > 0 && <button type="button" className="pf-link" onClick={clearAll} data-testid="button-clear-all">CLEAR ALL</button>}<span className="sec">FEED: YAHOO PROTOTYPE</span></div>
          </section>
        </div>

        <section className="pf-card pf-xl">
          <div className="pf-card-head pf-ph-head">
            <div><div className="pf-kicker">HISTORICAL PRICE DATA</div><h3 className="pf-h-md">Price history</h3></div>
            <div className="pf-ph-tools">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter assets..." aria-label="Filter assets" data-testid="input-filter-assets" />
              <button type="button" className="pf-btn-quiet" onClick={exportRows} disabled={!rows.length} data-testid="button-export-history">Export Data Report</button>
            </div>
          </div>
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead><tr><th>Asset Name</th><th>Data Source</th><th>Available Date Range</th><th>Data Status</th><th className="r">Action</th></tr></thead>
              <tbody>
                {inspect.isPending && <tr><td colSpan={5} className="mute">Inspecting price history…</td></tr>}
                {!inspect.isPending && shown.length === 0 && <tr><td colSpan={5} className="mute">{rows.length ? 'No assets match this filter.' : 'Add holdings and confirm to inspect price history.'}</td></tr>}
                {!inspect.isPending && shown.map((r) => <RowView key={r.key} r={r} open={openRow === r.key} toggle={() => setOpenRow(openRow === r.key ? undefined : r.key)} v={r.inst ? valuedFor(r.inst.ticker, r.inst.exchange) : undefined} />)}
              </tbody>
            </table>
          </div>
          {report && report.dataNotes.length > 0 && <ul className="pf-notes">{report.dataNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </section>
        <footer className="pf-foot">Source: {universe.data?.source ?? 'Yahoo Finance'} (prototype, may be incomplete). Fictional 2090 learning tool; no advice, no trading.</footer>
      </main>}
    </div>

    {csvPreview && <Modal kicker="CSV UPLOAD" title={`Review ${csvName || 'CSV'}`} onClose={closeCsv}>
      <p className="pf-hint">{csvPreview.note}</p>
      <div className="pf-map-grid">
        {(Object.keys(fieldNames) as FieldKey[]).map((k) => <label key={k}><span>{fieldNames[k]}{(k === 'ticker' || k === 'quantity') ? ' *' : ''}</span>
          <select value={columnMap[k]} onChange={(e) => setColumnMap((o) => ({ ...o, [k]: e.target.value }))} data-testid={`select-map-${k}`}>
            <option value="">{k === 'exchange' ? 'Default: NSE' : k === 'instrumentType' ? 'Default: stock' : 'Choose column'}</option>
            {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
          </select></label>)}
      </div>
      <div className="pf-table-wrap pf-modal-table">
        <table className="pf-table"><thead><tr><th>Row</th><th>Ticker</th><th>Exchange</th><th>Type</th><th>Quantity</th><th>Check</th></tr></thead>
          <tbody>{mapped.map((r, n) => <tr key={`${r.rowNumber}-${n}`}><td>{r.rowNumber}</td><td>{r.ticker || '—'}</td><td>{r.exchange}</td><td>{r.instrumentType === '—' ? '—' : r.instrumentType.toUpperCase()}</td><td>{r.quantity || '—'}</td><td><span className={`pf-status ${r.valid ? 'sec' : 'err'}`}>{r.valid ? 'Ready' : r.errors.join(' ')}</span></td></tr>)}</tbody></table>
      </div>
      {csvError && <p className="pf-err" role="alert">{csvError}</p>}
      <div className="pf-sum-foot">
        <p><span>{overLimit ? 'This would exceed the 50-holding limit. Nothing added.' : `${readyRows.length} of ${csvRows.length} rows ready. Fix every flagged row; none are skipped.`}</span></p>
        <button type="button" className="pf-btn-primary" onClick={addCsvRows} disabled={!canAddCsv} data-testid="button-add-csv-rows">Add all {csvRows.length} rows</button>
      </div>
    </Modal>}

    {showConfirm && <Modal kicker="CONFIRMATION" title="Inspect price history?" onClose={() => setShowConfirm(false)}>
      <p className="pf-body-md mute">{holdings.length} holding{holdings.length === 1 ? '' : 's'} will be sent to the analysis service to fetch market history from {universe.data?.source ?? 'the configured source'}. Nothing is saved.</p>
      <div className="pf-sum-foot">
        <button type="button" className="pf-btn-quiet" onClick={() => setShowConfirm(false)}>Go back</button>
        <button type="button" className="pf-btn-primary" onClick={confirmInspect} disabled={inspect.isPending} data-testid="button-confirm-inspection">{inspect.isPending ? <><LoaderCircle className="pf-spin" size={16} /> Inspecting</> : 'Confirm and inspect'}</button>
      </div>
    </Modal>}
  </div>;
}

function RowView({ r, open, toggle, v }: { r: { name: string; sub: string; source: string; range: string; status: string; tone: string; inst?: InstrumentMarketReport }; open: boolean; toggle: () => void; v?: ValuedHolding }) {
  const i = r.inst;
  return <>
    <tr data-testid={`row-history-${r.name}`}>
      <td className="b">{r.name} <span className="mute">({r.sub})</span></td>
      <td className="sec">{r.source}</td>
      <td className="mono mute">{r.range}</td>
      <td><span className={`pf-status ${r.tone}`}>{r.status}</span></td>
      <td className="r">{i ? <button type="button" className="pf-link" onClick={toggle} aria-expanded={open}>{open ? 'Hide Details' : 'View Details'}</button> : <span className="mute">—</span>}</td>
    </tr>
    {open && i && <tr className="pf-detail"><td colSpan={5}>
      <dl>
        <div><dt>Raw close / date</dt><dd>{v?.priceInr != null ? `${inrFmt(v.priceInr)} (${v.asOfDate ?? '—'})` : '—'}</dd></div>
        <div><dt>Value / weight</dt><dd>{v?.valueInr != null ? `${inrFmt(v.valueInr)}${v.weightPct != null ? ` · ${v.weightPct}%` : ''}` : '—'}</dd></div>
        <div><dt>Observations</dt><dd>{i.observationCount}</dd></div>
        <div><dt>Adjusted closes</dt><dd>{i.adjustedCloseCount}</dd></div>
        <div><dt>Missing adj. closes</dt><dd>{i.missingAdjustedCloseCount}</dd></div>
        <div><dt>As of</dt><dd>{i.asOfDate ?? '—'}</dd></div>
        <div><dt>Calendar gaps</dt><dd>{i.calendarGaps.length}</dd></div>
        <div><dt>Suspicious jumps</dt><dd>{i.suspiciousJumps.length}</dd></div>
        <div><dt>Splits</dt><dd>{i.splits.length}</dd></div>
        {i.proxyInstrument && <div><dt>Proxy window</dt><dd>{i.proxyStartDate ?? '—'} – {i.proxyEndDate ?? '—'}</dd></div>}
      </dl>
      {v?.reason && <p className="pf-body-sm mute">Valuation: {v.reason}</p>}
      {i.skipReason && <p className="pf-err">{i.skipReason}</p>}
      {i.adjustmentConcerns.map((c) => <p key={c} className="pf-body-sm mute">{c}</p>)}
    </td></tr>}
  </>;
}
