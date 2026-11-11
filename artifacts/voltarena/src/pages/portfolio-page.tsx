import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  BadgeCheck, BarChart3, ClipboardCheck, CloudLightning, CloudUpload, FlaskConical, LayoutDashboard,
  LoaderCircle, Lock, Plus, Radar, Siren, TrendingUp, User, X,
} from 'lucide-react';
import {
  useGetMarketDataUniverse,
  usePreviewPortfolioCsv,
  useValidatePortfolioInput,
  useInspectPortfolioMarketData,
} from '@workspace/api-client-react';
import type {
  Exchange, InstrumentType, PortfolioInspectReport, CsvPreviewReport, PortfolioInputIssue, InstrumentMarketReport,
} from '@workspace/api-client-react';
import { CrashAnalytics } from './crash-analytics';
import { RiskLab } from './risk-lab';
import { Simulator } from './simulator';
import './portfolio-page.css';

type StationId = 'portfolio' | 'crash' | 'risklab' | 'simulator' | 'report';
type Tab = 'manual' | 'csv' | 'sample';
type FieldKey = 'ticker' | 'exchange' | 'instrumentType' | 'quantity';
type Holding = { rowId: string; ticker: string; exchange: Exchange; instrumentType: InstrumentType; quantity: string; purchasePrice?: string };

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
  const preview = usePreviewPortfolioCsv();
  const validate = useValidatePortfolioInput();
  const inspect = useInspectPortfolioMarketData();
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

  useEffect(() => {
    const on = () => setStation(readHash());
    window.addEventListener('hashchange', on); window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  const go = (id: StationId) => { setStation(id); if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`); };

  const configured = universe.data?.instruments ?? [];
  const sampleInstrument = configured.find((i) => i.ticker === 'VEDL' && i.exchange === 'NSE' && i.instrumentType === 'stock');
  const sampleLoaded = holdings.some((h) => h.rowId === sampleRowId);

  const invalidate = () => { inputRevision.current += 1; setReport(undefined); setReportError(''); setShowConfirm(false); setIssues([]); setValidationError(''); };

  const addManual = () => {
    if (inspect.isPending) return;
    let t = symbol.trim().toUpperCase();
    let ex = exchange;
    if (t.endsWith('.NS')) { t = t.slice(0, -3); ex = 'NSE'; } else if (t.endsWith('.BO')) { t = t.slice(0, -3); ex = 'BSE'; }
    const qty = Number(quantity);
    if (!tickerRe.test(t) || !Number.isFinite(qty) || qty <= 0) { setManualError('Enter a valid symbol and a positive quantity.'); return; }
    if (price.trim() && (!Number.isFinite(Number(price)) || Number(price) < 0)) { setManualError('Purchase price must be a finite positive number or zero, or leave it blank.'); return; }
    if (holdings.length >= 50) { setManualError('A session supports at most 50 holdings.'); return; }
    if (holdings.some((h) => h.ticker === t && h.exchange === ex)) { setManualError(`${t} on ${ex} is already in this session.`); return; }
    setManualError('');
    setHoldings((cur) => [...cur, { rowId: crypto.randomUUID(), ticker: t, exchange: ex, instrumentType, quantity: quantity.trim(), purchasePrice: price.trim() || undefined }]);
    setSymbol(''); setQuantity(''); setPrice('');
    invalidate();
  };

  const removeHolding = (rowId: string) => {
    setHoldings((items) => items.filter((h) => h.rowId !== rowId));
    if (rowId === sampleRowId) setSampleRowId(undefined);
    invalidate();
  };
  const clearAll = () => { setHoldings([]); setSampleRowId(undefined); invalidate(); inspect.reset(); validate.reset(); };

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

  const readFile = (file: File) => {
    if (file.size > 80_000) { setCsvError('This CSV is over the 80 KB limit. No rows were added.'); return; }
    setCsvName(file.name); setCsvError(''); setCsvNotice(''); setCsvPreview(undefined);
    const reader = new FileReader();
    reader.onload = () => {
      preview.mutate({ data: { csvText: String(reader.result ?? '') } }, {
        onSuccess: (parsed) => {
          if (!parsed.columns.length || !parsed.rows.length) { setCsvError('This file has no readable rows. Use a CSV with a header row and at least one holding.'); return; }
          setCsvPreview(parsed);
          if (!Number.isFinite(parsed.rowCount) || parsed.rowCount !== parsed.rows.length) {
            setCsvError(`The preview returned ${parsed.rows.length} rows but reported ${String(parsed.rowCount)}. Nothing was added.`);
          }
          const s = parsed.suggestedMapping;
          setColumnMap({ ticker: s.tickerColumn ?? '', exchange: s.exchangeColumn ?? '', instrumentType: s.instrumentTypeColumn ?? '', quantity: s.quantityColumn ?? '' });
        },
        onError: (error) => { setCsvPreview(undefined); setCsvError(`We could not preview this CSV. ${errorMessage(error)} No rows were added.`); },
      });
    };
    reader.onerror = () => setCsvError('We could not read this file. No rows were added.');
    reader.readAsText(file);
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; };
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); };
  const closeCsv = () => { setCsvPreview(undefined); setCsvName(''); preview.reset(); };
  const addCsvRows = () => {
    if (!canAddCsv) return;
    setHoldings((cur) => [...cur, ...readyRows.map((r) => ({ rowId: crypto.randomUUID(), ticker: r.ticker, exchange: r.exchange as Exchange, instrumentType: r.instrumentType as InstrumentType, quantity: r.quantity }))]);
    setCsvNotice(`${readyRows.length} ${readyRows.length === 1 ? 'row' : 'rows'} added to this session.`);
    closeCsv(); setCsvError(''); invalidate();
  };

  const loadSample = () => {
    setSampleError('');
    if (inspect.isPending || preview.isPending || csvPreview) { setSampleError('Finish the current inspection or CSV review first.'); return; }
    if (holdings.length) { setSampleError('Clear current holdings first; existing rows are never replaced.'); return; }
    if (!sampleInstrument) { setSampleError('VEDL is not in the configured list right now.'); return; }
    const rowId = crypto.randomUUID();
    setSampleRowId(rowId);
    setHoldings([{ rowId, ticker: sampleInstrument.ticker, exchange: sampleInstrument.exchange, instrumentType: sampleInstrument.instrumentType, quantity: '1' }]);
    invalidate();
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
    setReport(undefined); setReportError('');
    inspect.mutate({ data: { holdings: apiHoldings } }, {
      onSuccess: (r) => { if (revision !== inputRevision.current) return; setReport(r); setShowConfirm(false); },
      onError: (e) => { if (revision !== inputRevision.current) return; setReportError(errorMessage(e)); setShowConfirm(false); },
    });
  };

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
    const lines = [['Asset', 'Symbol', 'Data source', 'Available date range', 'Data status', 'Observations', 'Missing adjusted closes'].map(esc).join(',')];
    rows.forEach((r) => lines.push([r.name, r.sub, r.source, r.range, r.status, r.inst ? String(r.inst.observationCount) : '', r.inst ? String(r.inst.missingAdjustedCloseCount) : ''].map(esc).join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'price-history-inspection.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const feedLabel = universe.isLoading ? 'CHECKING' : universe.isError ? 'UNREACHABLE' : 'YAHOO // PROTOTYPE';
  const sysLabel = universe.isLoading ? 'SYS.CHECKING' : universe.isError ? 'SYS.OFFLINE' : 'SYS.ONLINE';

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
        <div className="pf-user"><div><b>Investor Lvl —</b><small>— XP</small></div><span><User size={18} /></span></div>
      </header>

      <main className="pf-main" hidden={station !== 'crash'}>
        <CrashAnalytics key={report?.checkedAt ?? 'none'} holdings={apiHoldings} inspectionKey={report?.checkedAt} onReturn={() => go('portfolio')} />
      </main>
      <main className="pf-main" hidden={station !== 'risklab'}>
        <RiskLab key={report?.checkedAt ?? 'none'} holdings={apiHoldings} inspectionKey={report?.checkedAt} />
      </main>
      <main className="pf-main" hidden={station !== 'simulator'}>
        <Simulator key={report?.checkedAt ?? 'none'} holdings={apiHoldings} inspectionKey={report?.checkedAt} />
      </main>
      {station === 'crash' || station === 'risklab' || station === 'simulator' ? null : station !== 'portfolio' ? <main className="pf-main"><div className="pf-await" data-testid="panel-awaiting-design">
        <Radar size={18} /><div><b>Awaiting your next page design</b><p>{stations.find((s) => s.id === station)?.label}</p></div>
      </div></main> : <main className="pf-main">
        <div className="pf-tiles">
          <div className="pf-card pf-tile pf-glow">
            <div><div className="pf-label pri">Total Portfolio Value</div><div className="pf-h-lg" data-testid="text-total-value">—</div></div>
            <div className="pf-note sec"><TrendingUp size={16} /> Not calculated by the analysis service</div>
          </div>
          <div className="pf-card pf-tile">
            <div><div className="pf-label pri">Learning Progress</div><div className="pf-h-lg">— / 5 Modules</div></div>
            <div className="pf-bar"><i style={{ width: 0 }} /></div>
          </div>
          <div className="pf-card pf-tile pf-tile-row">
            <div><div className="pf-label sec">Investor Rank &amp; Badge</div><div className="pf-h-sm">Investor Lvl —</div><span className="pf-chip">Not tracked</span></div>
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
                  <label><span>Purchase Price (₹)</span><input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" data-testid="input-purchase-price" /></label>
                </div>
                <div className="pf-manual-foot">
                  <div className="pf-mini-selects">
                    <select aria-label="Exchange" value={exchange} onChange={(e) => setExchange(e.target.value as Exchange)} data-testid="select-exchange"><option value="NSE">NSE</option><option value="BSE">BSE</option></select>
                    <select aria-label="Instrument type" value={instrumentType} onChange={(e) => setInstrumentType(e.target.value as InstrumentType)} data-testid="select-instrument-type"><option value="stock">Stock</option><option value="etf">ETF</option></select>
                  </div>
                  <button type="button" className="pf-btn-accent" onClick={addManual} disabled={inspect.isPending} data-testid="button-add-holding"><Plus size={18} /> Add Asset</button>
                </div>
                {manualError && <p className="pf-err" role="alert">{manualError}</p>}
              </div>}

              {tab === 'csv' && <div>
                <div className={`pf-drop ${dragging ? 'is-drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }} data-testid="dropzone-csv">
                  {preview.isPending ? <LoaderCircle className="pf-spin" size={36} /> : <CloudUpload size={36} />}
                  <div className="pf-h-sm">{preview.isPending ? 'Reading your CSV…' : 'Drag & Drop Holdings CSV Here'}</div>
                  <div className="pf-body-sm">Supports .csv up to 80 KB. Every row is previewed first.</div>
                  <span className="pf-btn-quiet">Browse Local Files</span>
                </div>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} hidden data-testid="input-csv-file" />
                {csvNotice && <p className="pf-ok" role="status">{csvNotice}</p>}
                {csvError && !csvPreview && <p className="pf-err" role="alert">{csvError}</p>}
              </div>}

              {tab === 'sample' && <div className="pf-samples">
                <button type="button" className="pf-sample" onClick={loadSample} disabled={!sampleInstrument || sampleLoaded} data-testid="button-sample-vedl">
                  <div className="pf-h-sm">VEDL sample</div>
                  <div className="pf-body-sm">One NSE share, clearly marked as sample input</div>
                  <div className="pf-label pri pf-mt">{sampleLoaded ? 'Loaded in this session' : universe.isLoading ? 'Checking configured list' : sampleInstrument ? 'Est. value: not calculated' : 'Unavailable in configured list'}</div>
                </button>
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
                  <div className="pf-h-lg pri">—</div>
                  <div className="pf-body-sm sec">Not provided by the analysis service</div>
                </div>
                <div className="pf-inner pf-alloc">
                  <div className="pf-label mute">ASSET ALLOCATION</div>
                  <div className="pf-alloc-bar"><i /></div>
                  <div className="pf-label mute">No weights returned</div>
                </div>
              </div>
              <div className="pf-sum-foot">
                <p><Lock size={16} className="sec" /><span>Holdings stay in this browser session; nothing is saved.</span></p>
                <button type="button" className="pf-btn-primary" onClick={beginReview} disabled={!canReview} data-testid="button-review-confirmation">
                  {validate.isPending ? <><LoaderCircle className="pf-spin" size={16} /> Checking</> : inspect.isPending ? <><LoaderCircle className="pf-spin" size={16} /> Inspecting</> : 'Confirm & Inspect'}
                </button>
              </div>
              {!holdings.length && <p className="pf-hint">Add at least one holding to inspect price history.</p>}
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
              <p className="pf-body-sm mute">{holdings.length ? `${holdings.length} / 50 holdings in session. Weights not calculated.` : 'No holdings in this session yet.'}</p>
            </div>
            <div className="pf-orbit">
              <i className="r1" /><i className="r2" /><i className="r3" />
              <div className={`pf-core ${holdings.length ? '' : 'is-empty'}`}>CORE</div>
              {holdings.slice(0, 4).map((h, n) => <div key={h.rowId} className={`pf-node ${nodeSlots[n]}`} data-testid={`node-holding-${n}`}>
                <div className="pf-label">{h.ticker}{h.rowId === sampleRowId ? ' · SAMPLE' : ''}</div>
                <div className="pf-node-v">QTY {h.quantity}</div>
                <button type="button" onClick={() => removeHolding(h.rowId)} aria-label={`Remove ${h.ticker}`} data-testid={`button-remove-${n}`}><X size={12} /></button>
              </div>)}
            </div>
            {holdings.length > 4 && <div className="pf-more">
              {holdings.slice(4).map((h, n) => <span key={h.rowId}>{h.ticker} <small>{h.quantity}</small><button type="button" onClick={() => removeHolding(h.rowId)} aria-label={`Remove ${h.ticker}`} data-testid={`button-remove-${n + 4}`}><X size={11} /></button></span>)}
            </div>}
            {sampleLoaded && <p className="pf-body-sm pri pf-sample-note" data-testid="text-sample-banner">Sample input: one VEDL share, not your holding and not a suggestion.</p>}
            <div className="pf-map-foot"><span>VOLATILITY: —</span>{holdings.length > 0 && <button type="button" className="pf-link" onClick={clearAll} data-testid="button-clear-all">CLEAR ALL</button>}<span className="sec">FEED: YAHOO PROTOTYPE</span></div>
          </section>
        </div>

        <section className="pf-card pf-xl">
          <div className="pf-card-head pf-ph-head">
            <div><div className="pf-kicker">HISTORICAL PRICE DATA</div><h3 className="pf-h-md">Price history</h3></div>
            <div className="pf-ph-tools">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter assets..." aria-label="Filter assets" data-testid="input-filter-assets" />
              <button type="button" className="pf-btn-quiet" onClick={exportRows} disabled={!rows.length} data-testid="button-export-history">Export Price history</button>
            </div>
          </div>
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead><tr><th>Asset Name</th><th>Data Source</th><th>Available Date Range</th><th>Data Status</th><th className="r">Action</th></tr></thead>
              <tbody>
                {inspect.isPending && <tr><td colSpan={5} className="mute">Inspecting price history…</td></tr>}
                {!inspect.isPending && shown.length === 0 && <tr><td colSpan={5} className="mute">{rows.length ? 'No assets match this filter.' : 'Add holdings and confirm to inspect price history.'}</td></tr>}
                {!inspect.isPending && shown.map((r) => <RowView key={r.key} r={r} open={openRow === r.key} toggle={() => setOpenRow(openRow === r.key ? undefined : r.key)} />)}
              </tbody>
            </table>
          </div>
          {report && report.dataNotes.length > 0 && <ul className="pf-notes">{report.dataNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </section>
        <footer className="pf-foot">Source: {universe.data?.source ?? 'Yahoo Finance'} (prototype, may be incomplete). Fictional 2090 learning tool; no advice, no trading.</footer>
      </main>}
    </div>

    {csvPreview && <Modal kicker="CSV UPLOAD" title={`Review ${csvName || 'CSV'}`} onClose={closeCsv}>
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

function RowView({ r, open, toggle }: { r: { name: string; sub: string; source: string; range: string; status: string; tone: string; inst?: InstrumentMarketReport }; open: boolean; toggle: () => void }) {
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
        <div><dt>Observations</dt><dd>{i.observationCount}</dd></div>
        <div><dt>Adjusted closes</dt><dd>{i.adjustedCloseCount}</dd></div>
        <div><dt>Missing adj. closes</dt><dd>{i.missingAdjustedCloseCount}</dd></div>
        <div><dt>As of</dt><dd>{i.asOfDate ?? '—'}</dd></div>
        <div><dt>Calendar gaps</dt><dd>{i.calendarGaps.length}</dd></div>
        <div><dt>Suspicious jumps</dt><dd>{i.suspiciousJumps.length}</dd></div>
        <div><dt>Splits</dt><dd>{i.splits.length}</dd></div>
        {i.proxyInstrument && <div><dt>Proxy window</dt><dd>{i.proxyStartDate ?? '—'} – {i.proxyEndDate ?? '—'}</dd></div>}
      </dl>
      {i.skipReason && <p className="pf-err">{i.skipReason}</p>}
      {i.adjustmentConcerns.map((c) => <p key={c} className="pf-body-sm mute">{c}</p>)}
    </td></tr>}
  </>;
}
