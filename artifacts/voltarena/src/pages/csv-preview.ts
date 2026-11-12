import type { CsvPreviewReport } from '@workspace/api-client-react';

/** Structural CSV parsing only. Python still validates holdings and owns all finance. */
export function previewCsvLocally(input: string): CsvPreviewReport {
  if (!input.trim()) throw new Error('Choose a non-empty CSV file.');
  if (new TextEncoder().encode(input).length > 80000) throw new Error('CSV exceeds the 80 KB session limit.');
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, started = false;
  const endCell = () => { cells.push(cell); cell = ''; closed = false; started = false; };
  const endRow = () => {
    endCell(); records.push(cells); cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += c;
    } else if (c === ',') endCell();
    else if (c === '\n' || c === '\r') {
      endRow();
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (closed) {
      throw new Error(`CSV quoting is invalid near row ${records.length + 1}. A closing quote must be followed by a comma or line break.`);
    } else if (c === '"') {
      if (started) throw new Error(`Unexpected quote near row ${records.length + 1}. Quote the whole cell and double quotes inside it.`);
      quoted = true; started = true;
    } else { cell += c; started = true; }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted cell. No rows were added.');
  if (started || closed || cells.length || cell.length) endRow();
  const headers = records.shift();
  if (!headers?.length || headers.every((h) => !h.trim())) throw new Error('CSV must include a header row.');
  if (headers.length > 30) throw new Error('CSV may contain at most 30 columns.');
  const used = new Set<string>();
  const columns = headers.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    let name = base, n = 2;
    while (used.has(name)) name = `${base} (${n++})`;
    used.add(name);
    return name;
  });
  const rows: CsvPreviewReport['rows'] = [];
  let blankRows = 0;
  records.forEach((record, i) => {
    if (record.every((c) => !c.trim())) { blankRows++; return; }
    if (record.length !== columns.length) throw new Error(`Row ${i + 2} has ${record.length} cells; expected ${columns.length}. No rows were added.`);
    if (rows.length >= 50) throw new Error('CSV may contain at most 50 non-empty holding rows. No rows were added.');
    rows.push({ rowNumber: i + 2, cells: record.map((c) => c.trim()) });
  });
  if (!rows.length) throw new Error('This CSV has no holding rows. Include a header row and at least one holding.');
  const suggest = (aliases: string[]) => columns.find((c) => aliases.includes(c.toLowerCase().replace(/[^a-z0-9]/g, ''))) ?? null;
  return {
    columns, rows, rowCount: rows.length,
    suggestedMapping: {
      tickerColumn: suggest(['ticker', 'symbol', 'stock', 'security', 'scrip']),
      quantityColumn: suggest(['quantity', 'qty', 'shares', 'units', 'holding']),
      exchangeColumn: suggest(['exchange', 'market']),
      instrumentTypeColumn: suggest(['type', 'instrumenttype', 'assettype']),
    },
    note: `Preview created locally in this tab; no CSV preview network request or file storage. Review every row and mapping. Python validation and confirmation are required before analysis.${blankRows ? ` ${blankRows} empty row(s) ignored; no holding rows were omitted.` : ''}`,
  };
}
