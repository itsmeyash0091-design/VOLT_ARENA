import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  ArrowRight, Check, ChevronDown, CircleAlert, CircleCheck,
  Clock3, FileSpreadsheet, FileText, Info, LoaderCircle, Plus, RotateCcw,
  ShieldCheck, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { RiskAnalysis } from '@/components/risk-analysis';
import { StressLab } from '@/components/stress-lab';
import { ResilienceLab } from '@/components/resilience-lab';
import { Debrief } from '@/components/debrief';
import {
  useGetMarketDataUniverse,
  usePreviewPortfolioCsv,
  useValidatePortfolioInput,
  useInspectPortfolioMarketData,
} from '@workspace/api-client-react';
import type {
  Exchange, InstrumentMarketReport, InstrumentType,
  PortfolioInspectReport, CsvPreviewReport, PortfolioInputIssue,
  PortfolioRiskAnalysisReport, PortfolioStressReport, ResilienceReport,
} from '@workspace/api-client-react';

type FieldKey = 'ticker' | 'exchange' | 'instrumentType' | 'quantity';
type PortfolioHolding = { ticker: string; exchange: Exchange; instrumentType: InstrumentType; quantity: string };
type DraftHolding = PortfolioHolding & { rowId: string };
type EntryMode = 'manual' | 'csv' | 'sample' | null;
type StationResults = { key?: string; risk?: PortfolioRiskAnalysisReport; stress?: PortfolioStressReport; resilience?: ResilienceReport };

const fieldNames: Record<FieldKey, string> = {
  ticker: 'Ticker', exchange: 'Exchange', instrumentType: 'Type', quantity: 'Quantity',
};
const defaultMap: Record<FieldKey, string> = { ticker: '', exchange: '', instrumentType: '', quantity: '' };

function normalizeType(value: string): InstrumentType {
  return value.trim().toLowerCase() === 'etf' ? 'etf' : 'stock';
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something interrupted the request. Please try again.';
}

function csvPreviewError(error: unknown): string {
  const message = errorMessage(error);
  if (/row \d+ has/i.test(message)) {
    return `A CSV row does not have the same number of columns as the header. ${message} Fix that row and upload the file again. No rows were added.`;
  }
  if (/quoting or delimiter/i.test(message)) {
    return 'We could not read the quotes or commas in this CSV. Check that every row uses the same columns, then try again. No rows were added.';
  }
  if (/80 kb/i.test(message)) {
    return 'This CSV is over the 80 KB limit. Choose a smaller file. No rows were added.';
  }
  return `We could not preview this CSV. Check that it has a header row and matching columns on every row. ${message} No rows were added.`;
}

function SectionHeading({ number, title, note }: { number: string; title: string; note: string }) {
  return <div className="section-heading">
    <div className="section-index mono">{number}</div>
    <div><h2>{title}</h2><p>{note}</p></div>
  </div>;
}

function App() {
  const universe = useGetMarketDataUniverse();
  const preview = usePreviewPortfolioCsv();
  const validate = useValidatePortfolioInput();
  const inspect = useInspectPortfolioMarketData();
  const fileRef = useRef<HTMLInputElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const [holdings, setHoldings] = useState<DraftHolding[]>([]);
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [exchange, setExchange] = useState<Exchange>('NSE');
  const [instrumentType, setInstrumentType] = useState<InstrumentType>('stock');
  const [csvPreview, setCsvPreview] = useState<CsvPreviewReport>();
  const [csvError, setCsvError] = useState('');
  const [columnMap, setColumnMap] = useState<Record<FieldKey, string>>(defaultMap);
  const [csvName, setCsvName] = useState('');
  const [csvNotice, setCsvNotice] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>('manual');
  const [sampleRowId, setSampleRowId] = useState<string>();
  const [sampleError, setSampleError] = useState('');
  const [report, setReport] = useState<PortfolioInspectReport>();
  const [reportError, setReportError] = useState('');
  const [validationIssues, setValidationIssues] = useState<PortfolioInputIssue[]>([]);
  const [validationError, setValidationError] = useState('');
  const [manualError, setManualError] = useState('');
  const [stationResults, setStationResults] = useState<StationResults>({});

  const csvHeaders = csvPreview?.columns ?? [];
  const csvRows = csvPreview?.rows ?? [];
  const mappedHoldings = useMemo(() => {
    const rows = csvRows.map((record) => {
      const value = (field: FieldKey) => {
        const columnIndex = csvHeaders.indexOf(columnMap[field]);
        return columnIndex < 0 ? '' : (record.cells[columnIndex] ?? '').trim();
      };
      const rawTicker = value('ticker').toUpperCase();
      const rawExchange = value('exchange').toUpperCase();
      const quantityText = value('quantity');
      const qty = Number(quantityText.replace(/,/g, ''));
      const tickerValid = /^[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(rawTicker);
      const quantityFormatted = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/.test(quantityText) || /^\.\d+$/.test(quantityText);
      const quantityValid = quantityText !== '' && quantityFormatted && Number.isFinite(qty) && qty > 0;
      const exchangeValid = rawExchange === 'NSE' || rawExchange === 'BSE';
      const rawType = value('instrumentType').toLowerCase();
      const typeValid = !columnMap.instrumentType || rawType === 'stock' || rawType === 'etf';
      const errors: string[] = [];
      if (!columnMap.ticker) errors.push('Choose the Ticker column above.');
      else if (!rawTicker) errors.push('Enter a ticker.');
      else if (!tickerValid) errors.push('Ticker uses unsupported characters.');
      if (!columnMap.quantity) errors.push('Choose the Quantity column above.');
      else if (!quantityText) errors.push('Enter a quantity.');
      else if (!quantityFormatted) errors.push('Use a number; commas must separate thousands.');
      else if (!Number.isFinite(qty) || qty <= 0) errors.push('Quantity must be greater than zero.');
      if (columnMap.exchange && !exchangeValid) errors.push('Exchange must be NSE or BSE.');
      if (columnMap.instrumentType && !typeValid) errors.push('Type must be stock or ETF.');
      return {
        ticker: rawTicker,
        exchange: (!columnMap.exchange || exchangeValid ? (columnMap.exchange ? rawExchange : 'NSE') : '—') as Exchange | '—',
        instrumentType: (!columnMap.instrumentType ? 'stock' : typeValid ? normalizeType(rawType) : '—') as InstrumentType | '—',
        quantity: quantityText,
        errors,
      };
    });
    const seen = new Set(holdings.map((item) => `${item.exchange}:${item.ticker}`));
    return rows.map((row) => {
      const errors = [...row.errors];
      if (row.ticker && row.exchange !== '—' && /^[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(row.ticker)) {
        const key = `${row.exchange}:${row.ticker}`;
        if (seen.has(key)) errors.push('This ticker already appears in your session or this CSV.');
        else seen.add(key);
      }
      return { ...row, errors, valid: errors.length === 0 };
    });
  }, [csvRows, csvHeaders, columnMap, holdings]);
  const validCsvRows = mappedHoldings.filter((row) => row.valid && row.exchange !== '—' && row.instrumentType !== '—');
  const csvPreviewHasAllRows = !!csvPreview
    && Number.isFinite(csvPreview.rowCount)
    && csvPreview.rowCount === csvRows.length;
  const canInspect = holdings.length > 0 && holdings.length <= 50 && !inspect.isPending;
  const reportHasPartial = !!report && report.summary.skipped > 0;

  const addHolding = () => {
    if (inspect.isPending) return;
    const normalizedTicker = ticker.trim().toUpperCase();
    const qty = Number(quantity);
    if (!/^[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(normalizedTicker) || !Number.isFinite(qty) || qty <= 0) {
      setManualError('Enter a valid exchange ticker and a positive, finite quantity.');
      return;
    }
    if (holdings.length >= 50) {
      setManualError('A session supports at most 50 holdings.');
      return;
    }
    setManualError('');
    setHoldings((current) => [...current, { ticker: normalizedTicker, exchange, instrumentType, quantity: quantity.trim(), rowId: crypto.randomUUID() }]);
    setTicker(''); setQuantity('');
    setReport(undefined); setReportError(''); setShowConfirm(false);
    setValidationIssues([]); setValidationError('');
  };

  const addCsvRows = () => {
    if (inspect.isPending || !csvPreviewHasAllRows || !csvPreview || !validCsvRows.length || validCsvRows.length !== csvRows.length || holdings.length + csvRows.length > 50) return;
    setHoldings((current) => [...current, ...validCsvRows.map((row) => ({
      ticker: row.ticker, exchange: row.exchange as Exchange, instrumentType: row.instrumentType as InstrumentType,
      quantity: row.quantity, rowId: crypto.randomUUID(),
    }))]);
    setCsvNotice(`${validCsvRows.length} ${validCsvRows.length === 1 ? 'row' : 'rows'} added to your session.`);
    setCsvPreview(undefined); setCsvName(''); setCsvError('');
    setReport(undefined); setReportError(''); setShowConfirm(false);
    setValidationIssues([]); setValidationError('');
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 80_000) {
      setCsvError('This CSV is over the 80 KB limit. Choose a smaller file. No rows were added.');
      event.target.value = '';
      return;
    }
    setCsvName(file.name); setCsvNotice(''); setCsvError(''); setCsvPreview(undefined);
    const reader = new FileReader();
    reader.onload = () => {
      const csvText = String(reader.result ?? '');
      setCsvError('');
      preview.mutate({ data: { csvText } }, {
        onSuccess: (parsed) => {
          if (!parsed.columns.length || !parsed.rows.length) {
            setCsvError('This file has no readable rows. Choose a CSV with a header row and at least one holding.');
            setCsvPreview(undefined); return;
          }
          if (!Number.isFinite(parsed.rowCount) || parsed.rowCount < 0 || parsed.rowCount !== parsed.rows.length) {
            setCsvPreview(parsed);
            setCsvError(`The preview returned ${parsed.rows.length} rows, but reported ${String(parsed.rowCount)}. Nothing was added. Try the file again or contact support if this continues.`);
            return;
          }
          setCsvPreview(parsed);
          const suggestions = parsed.suggestedMapping;
          setColumnMap({
            ticker: suggestions.tickerColumn ?? '',
            exchange: suggestions.exchangeColumn ?? '',
            instrumentType: suggestions.instrumentTypeColumn ?? '',
            quantity: suggestions.quantityColumn ?? '',
          });
        },
        onError: (error) => {
          setCsvPreview(undefined);
          setCsvError(csvPreviewError(error));
        },
      });
    };
    reader.onerror = () => setCsvError('We could not read this file. Check that it is a CSV, then try again. No rows were added.');
    reader.readAsText(file);
    event.target.value = '';
  };

  const loadSample = () => {
    setEntryMode('sample');
    setSampleError('');
    if (holdings.length) {
      setSampleError('Clear the current session holdings before loading a sample. Nothing has been replaced.');
      return;
    }
    if (csvPreview || preview.isPending) {
      setSampleError('Finish or remove the CSV preview before loading a sample. No rows have been changed.');
      return;
    }
    if (!sampleInstrument) {
      setSampleError('A VEDL sample is not available in the configured list right now. Add holdings or upload a CSV instead.');
      return;
    }
    const rowId = crypto.randomUUID();
    setSampleRowId(rowId);
    setHoldings([{ ...sampleInstrument, quantity: '1', rowId }]);
    setReport(undefined); setReportError(''); setShowConfirm(false);
    setValidationIssues([]); setValidationError(''); setManualError(''); setCsvNotice('');
  };

  const startManualEntry = () => {
    setEntryMode('manual'); setManualError(''); setSampleError('');
  };

  const startCsvUpload = () => {
    setEntryMode('csv'); setSampleError(''); setCsvError('');
    fileRef.current?.click();
  };

  const addConfigured = (item: { ticker: string; exchange: Exchange; instrumentType: InstrumentType }) => {
    setEntryMode('manual');
    setTicker(item.ticker); setExchange(item.exchange); setInstrumentType(item.instrumentType);
    setTimeout(() => quantityInputRef.current?.focus(), 0);
  };

  const confirmInspection = () => {
    if (!canInspect) return;
    setReport(undefined); setReportError('');
    inspect.mutate({ data: { holdings: holdings.map(({ rowId: _rowId, ...holding }) => ({ ...holding, quantity: String(holding.quantity) })) } }, {
      onSuccess: (response) => { setReport(response); setShowConfirm(false); },
      onError: (error) => { setReportError(errorMessage(error)); setShowConfirm(false); },
    });
  };

  const resetWorkspace = () => {
    setHoldings([]); setReport(undefined); setReportError(''); setShowConfirm(false);
    setCsvPreview(undefined); setCsvName(''); setCsvNotice(''); setCsvError('');
    setEntryMode('manual'); setSampleRowId(undefined); setSampleError('');
    setValidationIssues([]); setValidationError('');
    setTicker(''); setQuantity(''); setManualError('');
    preview.reset(); validate.reset(); inspect.reset();
  };

  const configured = universe.data?.instruments ?? [];
  const sampleInstrument = configured.find((item) => item.ticker === 'VEDL' && item.exchange === 'NSE' && item.instrumentType === 'stock');
  const sampleAvailabilityNote = holdings.length
    ? 'Clear current session holdings before trying the sample; existing rows are never replaced.'
    : universe.isLoading ? 'Waiting for the configured symbol list.'
      : universe.isError ? 'The configured list could not be loaded. Retry it or enter holdings manually.'
        : !sampleInstrument ? 'VEDL is not in the configured list right now. Enter holdings or upload a CSV instead.'
          : csvPreview || preview.isPending ? 'Finish or remove the CSV preview before trying a sample.'
            : 'Adds one clearly marked example share to this session.';
  const inspectReport = report;
  const sampleLoaded = holdings.some((item) => item.rowId === sampleRowId);
  const resultKey = inspectReport?.checkedAt;
  const liveResults = resultKey && stationResults.key === resultKey ? stationResults : {};
  const keep = <K extends 'risk' | 'stress' | 'resilience'>(field: K) => (value: StationResults[K]) => {
    if (!resultKey) return;
    setStationResults((old) => ({ ...(old.key === resultKey ? old : { key: resultKey }), [field]: value }));
  };
  const apiHoldings = holdings.map(({ rowId: _rowId, ...holding }) => ({ ...holding, quantity: String(holding.quantity) }));
  const beginValidation = () => {
    if (!holdings.length || holdings.length > 50) return;
    setValidationIssues([]); setValidationError('');
    validate.mutate({ data: { holdings: holdings.map(({ rowId: _rowId, ...holding }) => ({ ...holding, quantity: String(holding.quantity) })) } }, {
      onSuccess: (result) => {
        setValidationIssues(result.issues);
        if (result.valid) setShowConfirm(true);
      },
      onError: (error) => setValidationError(errorMessage(error)),
    });
  };

  return <AppShell><main className="workspace">
    <div data-st="portfolio">
    <div className="ef-stats" data-testid="panel-session-stats">
      <div className="ef-stat"><span>HOLDINGS IN SESSION</span><b data-testid="text-holdings-count">{holdings.length}<small> / 50</small></b><p>{sampleLoaded ? 'Includes one marked sample input.' : 'Session only. Nothing is saved.'}</p></div>
      <div className="ef-stat"><span>MARKET HISTORY INSPECTION</span><b data-testid="text-inspection-state">{inspect.isPending ? 'Running' : inspectReport ? `${inspectReport.summary.succeeded} of ${inspectReport.summary.requested}` : 'Not run'}</b><p>{inspectReport ? 'Histories returned by the data source.' : 'Runs only after you confirm.'}</p></div>
      <div className="ef-stat"><span>MARKET DATA SOURCE</span><b className="ef-stat-small">{universe.data?.source ?? (universe.isLoading ? 'Loading' : 'Unavailable')}</b><p>Observed prices; missing values stay missing.</p></div>
    </div>
    <div className="content-grid">
      <section className="main-column" inert={inspect.isPending} aria-busy={inspect.isPending}>
        <div className="panel holdings-panel enter-delay">
          <SectionHeading number="01" title="Set up your portfolio" note="Pick one way to start. Your holdings stay in this session." />

          <div className="entry-choice-grid" role="group" aria-label="Choose how to start">
            <button type="button" className={`entry-choice ${entryMode === 'manual' ? 'is-active' : ''}`} onClick={startManualEntry} aria-pressed={entryMode === 'manual'} data-testid="button-entry-manual">
              <span className="entry-choice-title"><span className="entry-choice-number">01</span><strong>Add holdings</strong></span>
              <span className="entry-choice-copy">Type each ticker, exchange, type and quantity.</span>
              <span className="entry-choice-action">Enter holdings <ArrowRight size={14} /></span>
            </button>
            <button type="button" className={`entry-choice ${entryMode === 'csv' ? 'is-active' : ''}`} onClick={startCsvUpload} aria-pressed={entryMode === 'csv'} data-testid="button-entry-csv">
              <span className="entry-choice-title"><span className="entry-choice-number">02</span><strong>Upload a CSV</strong></span>
              <span className="entry-choice-copy">Preview every row and fix any issues before adding it.</span>
              <span className="entry-choice-action">Choose a file <Upload size={14} /></span>
            </button>
            <button type="button" className={`entry-choice ${entryMode === 'sample' ? 'is-active' : ''}`} onClick={loadSample} aria-pressed={entryMode === 'sample'} disabled={Boolean(holdings.length) || universe.isLoading || Boolean(universe.isError) || !sampleInstrument || Boolean(csvPreview) || preview.isPending} data-testid="button-entry-sample">
              <span className="entry-choice-title"><span className="entry-choice-number">03</span><strong>Try a sample</strong></span>
              <span className="entry-choice-copy">Load one clearly marked example share; it is not a real holding.</span>
              <span className="entry-choice-action">{holdings.some((item) => item.rowId === sampleRowId) ? 'Sample loaded' : 'Try the sample'} <Sparkles size={14} /></span>
            </button>
          </div>
          <p className="entry-sample-status" role="status">{sampleAvailabilityNote}</p>
          <p className="entry-blank-note">Blank CSV lines are ignored; every non-empty source row is previewed. Nothing is added until you choose Add all rows.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="visually-hidden" data-testid="input-csv-file" />
          {sampleError && <p className="entry-error" role="alert">{sampleError}</p>}

          {entryMode === 'manual' && <div className="entry-mode-panel">
            <div className="entry-mode-heading"><h3>Add holdings</h3><p>Use a configured symbol or enter each position below.</p></div>
            <div className="manual-entry">
            <div className="entry-label"><span className="tiny-dot" /> QUICK ADD</div>
            <div className="entry-fields">
              <label className="field ticker-field"><span>Ticker</span><input data-testid="input-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addHolding(); }} placeholder="e.g. INFY" aria-label="Ticker" /></label>
              <label className="field"><span>Exchange</span><select data-testid="select-exchange" value={exchange} onChange={(e) => setExchange(e.target.value as Exchange)}><option value="NSE">NSE</option><option value="BSE">BSE</option></select><ChevronDown size={13} /></label>
              <label className="field"><span>Instrument</span><select data-testid="select-instrument-type" value={instrumentType} onChange={(e) => setInstrumentType(e.target.value as InstrumentType)}><option value="stock">Stock</option><option value="etf">ETF</option></select><ChevronDown size={13} /></label>
              <label className="field quantity-field"><span>Quantity</span><input ref={quantityInputRef} data-testid="input-quantity" type="number" min="0.0001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addHolding(); }} placeholder="0" aria-label="Quantity" /></label>
              <button className="icon-add" onClick={addHolding} aria-label="Add holding" data-testid="button-add-holding"><Plus size={18} /></button>
            </div>
            {manualError && <p className="inline-notice error-copy" role="alert">{manualError}</p>}
            </div>
          </div>}

          {entryMode === 'csv' && <div className="entry-mode-panel csv-zone">
            <div className="entry-mode-heading"><h3>Upload a CSV</h3><p>Preview every row before adding anything.</p></div>
            {!csvPreview && !preview.isPending ? <button className="upload-box" onClick={() => fileRef.current?.click()} data-testid="button-upload-csv">
              <span className="upload-icon"><Upload size={17} /></span><span className="upload-copy"><strong>Choose a CSV file</strong><small>Preview the rows · up to 80 KB · nothing is added automatically</small></span><span className="upload-browse">Browse files <ArrowRight size={13} /></span>
            </button> : preview.isPending ? <div className="csv-loading"><span className="skeleton-line" /><span className="skeleton-line short" /><small>Reading your CSV in memory…</small></div> : csvPreview ? <div className="csv-card">
              <div className="csv-file"><FileSpreadsheet size={17} /><div><strong>{csvName}</strong><small>{Number.isFinite(csvPreview.rowCount) ? `${csvPreview.rowCount} non-empty source rows` : 'Source row count not returned'} · map each field below</small></div><button className="subtle-icon" onClick={() => { setCsvPreview(undefined); setCsvName(''); setCsvError(''); }} aria-label="Remove CSV"><X size={16} /></button></div>
              <div className="mapping-grid">
                {(Object.keys(fieldNames) as FieldKey[]).map((key) => <label className="map-field" key={key}><span>{fieldNames[key]} {(key === 'ticker' || key === 'quantity') && <i>required</i>}</span><select data-testid={`select-map-${key}`} value={columnMap[key]} onChange={(e) => setColumnMap((old) => ({ ...old, [key]: e.target.value }))}><option value="">{key === 'exchange' ? 'Default: NSE' : key === 'instrumentType' ? 'Default: stock' : 'Choose column'}</option>{csvHeaders.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>)}
              </div>
              <div className="preview-head"><span>ROW PREVIEW</span><span>{validCsvRows.length} ready / {Number.isFinite(csvPreview.rowCount) ? csvPreview.rowCount : 'count unavailable'} source rows</span></div>
              <div className="preview-table-wrap"><table className="preview-table"><thead><tr><th>Source row</th><th>Ticker</th><th>Exchange</th><th>Type</th><th>Quantity</th><th>Check</th></tr></thead><tbody>{mappedHoldings.map((row, index) => <tr key={`${row.ticker}-${index}`}><td className="mono">{csvRows[index]?.rowNumber ?? index + 2}</td><td className="mono">{row.ticker || '—'}</td><td>{row.exchange}</td><td>{row.instrumentType === '—' ? '—' : row.instrumentType.toUpperCase()}</td><td className="mono">{row.quantity || '—'}</td><td><span className={`row-check ${row.valid ? 'good' : 'bad'} csv-row-reason`} title={row.errors.join(' ')}>{row.valid ? 'Ready' : row.errors.join(' ')}</span></td></tr>)}</tbody></table></div>
              <div className="csv-actions"><span>{csvPreview.rowCount !== csvRows.length ? `The service returned ${csvRows.length} of ${String(csvPreview.rowCount)} source rows. Nothing was added.` : holdings.length + csvRows.length > 50 ? 'This would exceed the 50-holding session limit. No rows were added.' : 'Fix every flagged row before adding. No rows are silently skipped.'}</span><button className="button-primary compact" onClick={addCsvRows} disabled={!validCsvRows.length || validCsvRows.length !== csvRows.length || csvPreview.rowCount !== csvRows.length || holdings.length + csvRows.length > 50} data-testid="button-add-csv-rows"><Plus size={14} /> Add all {csvRows.length} rows</button></div>
             </div> : null}
            {csvNotice && <p className="inline-notice" role="status">{csvNotice}</p>}
            {csvError && <p className="inline-notice error-copy" role="alert">{csvError} <button onClick={() => { setCsvError(''); fileRef.current?.click(); }} data-testid="button-retry-csv">Try another file</button></p>}
          </div>}

        </div>

        <div className="confirm-card">
          <SectionHeading number="02" title="Ready to inspect?" note="Market history is fetched only after confirmation." />
          <div className="privacy-list"><div><Check size={14} /><span>CSV preview and validation use temporary server memory; nothing is saved</span></div><div><Check size={14} /><span>Inspection runs only after confirmation</span></div><div><Check size={14} /><span>No valuation or performance calculations</span></div></div>
          {!showConfirm ? <button className="button-primary inspect-button" disabled={!canInspect || validate.isPending} onClick={beginValidation} data-testid="button-review-confirmation">{validate.isPending ? <><LoaderCircle className="spin" size={15} /> Validating rows…</> : <><span>Review &amp; confirm</span><ArrowRight size={16} /></>}</button> : <div className="confirmation-box" data-testid="confirmation-panel"><div className="confirm-heading"><span className="confirm-marker"><ShieldCheck size={16} /></span><div><strong>Confirm inspection</strong><small>{holdings.length} holding{holdings.length === 1 ? '' : 's'} will be sent for market-history inspection.</small></div><button onClick={() => setShowConfirm(false)} aria-label="Close confirmation"><X size={15} /></button></div><p>Market history will be retrieved from the configured source. Your holdings are not saved by VoltArena.</p><button className="button-primary confirm-action" onClick={confirmInspection} disabled={inspect.isPending} data-testid="button-confirm-inspection">{inspect.isPending ? <><LoaderCircle className="spin" size={15} /> Inspecting history…</> : <>Confirm and inspect <ArrowRight size={15} /></>}</button><button className="text-button cancel-confirm" onClick={() => setShowConfirm(false)}>Go back</button></div>}
          {!holdings.length && <div className="disabled-hint">Add at least one holding to prepare an inspection.</div>}
          {holdings.length > 50 && <div className="disabled-hint warning">The API supports up to 50 holdings per inspection.</div>}
          {validationError && <div className="validation-feedback" role="alert"><CircleAlert size={14} />{validationError}</div>}
          {validationIssues.length > 0 && <div className="validation-feedback" role="alert"><CircleAlert size={14} /><div><strong>Some holdings need attention</strong>{validationIssues.map((issue, index) => <p key={`${issue.row}-${index}`}>Row {issue.row}: {issue.message}</p>)}</div></div>}
          {inspect.isPending && <div className="pending-copy"><span className="pending-pulse" />Checking the history returned by the market data source.</div>}
        </div>

        {reportError && <div className="error-banner" role="alert"><CircleAlert size={18} /><div><strong>Inspection could not be completed</strong><p>{reportError}</p></div><button onClick={() => { setReportError(''); setShowConfirm(true); }} data-testid="button-retry-inspection">Try again <ArrowRight size={14} /></button></div>}
      </section>

      <aside className="side-column">
        <div className="panel portfolio-view-panel" data-testid="panel-portfolio-view">
          <div className="ef-panel-kicker">SESSION HOLDINGS</div>
          <h3 className="ef-panel-title">Portfolio view</h3>
          <div className="holdings-summary">
            <div className="holdings-title"><span>IN THIS SESSION</span><b>{holdings.length}<small> / 50</small></b></div>
            {holdings.length === 0 ? <div className="empty-holdings"><div className="empty-symbol"><FileText size={19} /></div><div><strong>No holdings yet</strong><p>Start with a ticker or import your portfolio to prepare an inspection.</p></div></div> : <>
              <div className="holding-list">{holdings.map((holding, index) => <div className="holding-row" key={holding.rowId} data-testid={`row-holding-${index}`}><div className="ticker-badge">{holding.ticker.slice(0, 1)}</div><div className="holding-name"><strong>{holding.ticker}{holding.rowId === sampleRowId && <span className="sample-badge" data-testid={`badge-sample-${index}`}>Sample input</span>}</strong><small>{holding.exchange} <span>·</span> {holding.instrumentType.toUpperCase()}</small></div><div className="holding-qty"><span>QTY</span><b className="mono">{holding.quantity}</b></div><button className="subtle-icon remove-btn" onClick={() => { setHoldings((items) => items.filter((item) => item.rowId !== holding.rowId)); if (holding.rowId === sampleRowId) setSampleRowId(undefined); setReport(undefined); setShowConfirm(false); setValidationIssues([]); setValidationError(''); }} aria-label={`Remove ${holding.ticker}`} data-testid={`button-remove-${index}`}><Trash2 size={15} /></button></div>)}</div>
              {sampleLoaded && <p className="sample-banner" role="note" data-testid="text-sample-banner">Sample input: one VEDL share (NSE stock) from the configured list, added only to show how the stations work. It is not your holding and not a suggestion. Prices come from the data source after you confirm; none are made up here. Remove it or clear all to start with your own holdings.</p>}
              <div className="list-footer"><span>{holdings.length} {holdings.length === 1 ? 'instrument' : 'instruments'} staged for review</span><button onClick={() => { setHoldings([]); setSampleRowId(undefined); setReport(undefined); setShowConfirm(false); setValidationIssues([]); setValidationError(''); }} className="text-button" data-testid="button-clear-holdings">Clear all</button></div>
            </>}
          </div>
        </div>
        <div className="panel universe-panel">
          <div className="universe-top"><div><div className="eyebrow small-eyebrow">START WITH A KNOWN SYMBOL</div><h3>Configured market universe</h3><p>Examples from the symbols currently supported by the data source.</p></div><span className="universe-source">{universe.isLoading ? 'LOADING' : universe.data ? `${configured.length} SYMBOLS` : 'SOURCE'}</span></div>
          {universe.isLoading ? <div className="universe-loading"><span /><span /><span /></div> : universe.isError ? <div className="universe-error"><CircleAlert size={16} /><span>Configured symbols could not be loaded.</span><button onClick={() => { void universe.refetch(); }} data-testid="button-retry-universe">Retry</button></div> : configured.length === 0 ? <div className="universe-empty">No configured examples are available right now. You can still enter holdings manually.</div> : <div className="symbol-strip">{configured.map((item) => <button key={`${item.exchange}-${item.ticker}`} className="symbol-chip" onClick={() => addConfigured(item)} title={`Prefill ${item.ticker} in quick add`} data-testid={`button-add-symbol-${item.ticker}`}><span>{item.ticker}</span><small>{item.exchange} · {item.instrumentType.toUpperCase()}</small><Plus size={13} /></button>)}</div>}
          {universe.data?.source && <div className="source-line"><span>UNIVERSE SOURCE</span><span>{universe.data.source}</span></div>}
        </div>

        <div className="source-card">
          <div className="source-card-label"><span className="source-orbit"><span /></span><span>PROVENANCE FIRST</span></div>
          <h3>Useful context,<br />not a black box.</h3>
          <p>Each result reports the source symbol, date coverage, missing observations, calendar gaps, suspicious jumps and adjustment concerns returned by the inspection service.</p>
          <div className="source-divider" />
          <div className="source-foot"><span>MARKET DATA</span><b>{universe.data?.source ?? 'Configured source'}</b></div>
          <div className="source-foot"><span>YOUR RECORD</span><b>Session only</b></div>
        </div>
      </aside>
    </div>

    {inspectReport && <section className="report-section enter" id="inspection-report" data-testid="section-inspection-report">
      <div className="report-topline"><div><div className="eyebrow"><span className="eyebrow-rule" /> INSPECTION RESULT</div><h2>Market history, <em>laid bare.</em></h2><p>Coverage and quality signals returned by the data source. No additional metrics are inferred here.</p></div><button className="button-outline" onClick={resetWorkspace} data-testid="button-new-inspection"><RotateCcw size={14} /> New inspection</button></div>
      <div className={`report-summary ${reportHasPartial ? 'partial' : ''}`}>
        <div className="summary-status"><span className="status-symbol">{reportHasPartial ? <CircleAlert size={18} /> : <CircleCheck size={18} />}</span><div><span>{reportHasPartial ? 'PARTIAL COVERAGE' : 'INSPECTION COMPLETE'}</span><strong>{inspectReport.summary.succeeded} of {inspectReport.summary.requested} histories returned</strong></div></div>
        <div className="summary-count"><span>SUCCEEDED</span><b>{inspectReport.summary.succeeded.toString().padStart(2, '0')}</b></div>
        <div className="summary-count skipped"><span>SKIPPED</span><b>{inspectReport.summary.skipped.toString().padStart(2, '0')}</b></div>
        <div className="report-time"><Clock3 size={14} /><span>{new Date(inspectReport.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
      </div>
      <div className="report-meta"><span>DATA SOURCE <b>{inspectReport.source}</b></span><span>CHECKED <b>{new Date(inspectReport.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</b></span></div>
      {inspectReport.dataNotes.length > 0 && <div className="data-notes"><Info size={15} /><div><strong>Source notes</strong>{inspectReport.dataNotes.map((note, index) => <p key={`${index}-${note}`}>{note}</p>)}</div></div>}
      {inspectReport.instruments.length ? <div className="instrument-reports">{inspectReport.instruments.map((item, index) => <InstrumentCard item={item} index={index} key={`${item.exchange}-${item.ticker}-${index}`} />)}</div> : <div className="report-empty"><FileText size={20} /><span>The service returned no per-instrument results for this request.</span></div>}
    </section>}

    </div>

    {inspectReport && <div data-st="crash risklab" className="ef-w-risk"><RiskAnalysis
      key={`risk-${inspectReport.checkedAt}`}
      confirmed={Boolean(inspectReport)}
      holdings={apiHoldings}
      onResult={keep('risk')}
    /></div>}

    {inspectReport && <div data-st="risklab" className="ef-w-stress"><StressLab
      key={`stress-${inspectReport.checkedAt}`}
      holdings={apiHoldings}
      onResult={keep('stress')}
    /></div>}

    {inspectReport && <div data-st="report"><Debrief inspect={inspectReport} risk={liveResults.risk} stress={liveResults.stress} resilience={liveResults.resilience} holdingsCount={holdings.length} sampleLoaded={sampleLoaded} /></div>}

    {inspectReport && <div data-st="simulator report"><ResilienceLab
      key={`resilience-${inspectReport.checkedAt}`}
      holdings={apiHoldings}
      onResult={keep('resilience')}
    /></div>}

  </main></AppShell>;
}

function InstrumentCard({ item, index }: { item: InstrumentMarketReport; index: number }) {
  const [expanded, setExpanded] = useState(index === 0);
  const skipped = item.status === 'skipped';
  const dataStatus = item.dataType === 'observed' ? 'Observed' : item.dataType === 'proxy' ? 'Proxy history' : 'Insufficient';
  return <article className={`instrument-card ${skipped ? 'is-skipped' : ''}`} data-testid={`card-instrument-${item.ticker}`}>
    <button className="instrument-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} data-testid={`button-expand-instrument-${item.ticker}`}>
      <div className={`instrument-state ${skipped ? 'state-skipped' : ''}`}>{skipped ? <CircleAlert size={16} /> : <Check size={16} />}</div>
      <div className="instrument-identity"><div><strong>{item.ticker}</strong><span>{item.exchange}</span><span className="instrument-type">{item.instrumentType.toUpperCase()}</span></div><small>{item.yahooSymbol} <i>·</i> {skipped ? 'Skipped' : dataStatus}</small></div>
      <div className="instrument-coverage"><span>{skipped ? 'RESULT' : 'COVERAGE'}</span><b>{skipped ? 'Not available' : item.coverageStart && item.coverageEnd ? `${item.coverageStart} — ${item.coverageEnd}` : 'Not reported'}</b></div>
      <ChevronDown className={`expand-chevron ${expanded ? 'expanded' : ''}`} size={17} />
    </button>
    {expanded && <div className="instrument-detail">
      {skipped && item.skipReason && <div className="skip-reason"><CircleAlert size={15} /><span>{item.skipReason}</span></div>}
      {!skipped && <div className="metrics-grid">
        <Metric label="Data status" value={dataStatus} />
        <Metric label="As of" value={item.asOfDate ?? 'Not reported'} />
        <Metric label="Observations" value={String(item.observationCount)} />
        <Metric label="Adjusted close" value={`${item.adjustedCloseCount} available`} />
        <Metric label="Missing adjusted close" value={String(item.missingAdjustedCloseCount)} />
        {item.dataType === 'proxy' && <Metric label="Proxy instrument" value={item.proxyInstrument ?? 'Not reported'} note={item.proxyStartDate && item.proxyEndDate ? `${item.proxyStartDate} — ${item.proxyEndDate}` : undefined} />}
      </div>}
      <div className="diagnostics">
        <Diagnostic title="Calendar gaps" count={item.calendarGaps.length} empty="No calendar gaps reported." icon={<Clock3 size={14} />}>
          {item.calendarGaps.map((gap, i) => <div className="diagnostic-line" key={`${gap.previousDate}-${i}`}><span>{gap.previousDate} → {gap.nextDate}</span><small>{gap.calendarDays} calendar days · {gap.note}</small></div>)}
        </Diagnostic>
        <Diagnostic title="Suspicious jumps" count={item.suspiciousJumps.length} empty="No suspicious jumps reported." icon={<Sparkles size={14} />}>
          {item.suspiciousJumps.map((jump, i) => <div className="diagnostic-line" key={`${jump.date}-${i}`}><span>{jump.date} · {jump.percentChange}%</span><small>{jump.priceBasis.replace('_', ' ')} · {jump.note}</small></div>)}
        </Diagnostic>
        <Diagnostic title="Splits & adjustment" count={item.splits.length + item.adjustmentConcerns.length} empty="No splits or adjustment concerns reported." icon={<Info size={14} />}>
          {item.splits.map((split, i) => <div className="diagnostic-line" key={`${split.date}-${i}`}><span>Split recorded · {split.date}</span><small>Ratio {split.ratio}</small></div>)}
          {item.adjustmentConcerns.map((concern, i) => <div className="diagnostic-line" key={`${i}-${concern}`}><span>Adjustment concern</span><small>{concern}</small></div>)}
        </Diagnostic>
      </div>
    </div>}
  </article>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="metric-cell"><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</div>;
}

function Diagnostic({ title, count, empty, icon, children }: { title: string; count: number; empty: string; icon: ReactNode; children: ReactNode }) {
  return <section className="diagnostic"><div className="diagnostic-title">{icon}<strong>{title}</strong><span>{count}</span></div>{count ? <div>{children}</div> : <p>{empty}</p>}</section>;
}

export default App;
