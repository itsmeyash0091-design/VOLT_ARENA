import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewCsvLocally } from './csv-preview.ts';

test('preview needs no network and preserves raw holding text', () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Failed to fetch'); };
  let r;
  try { r = previewCsvLocally('ticker,quantity,exchange\nRELIANCE,8,NSE\nINFY,10,NSE\n'); }
  finally { globalThis.fetch = fetchBefore; }
  assert.equal(r.rowCount, 2);
  assert.deepEqual(r.rows[1], { rowNumber: 3, cells: ['INFY', '10', 'NSE'] });
  assert.equal(r.suggestedMapping.quantityColumn, 'quantity');
  assert.match(r.note, /Python validation/);
});
test('BOM, CRLF, quoted commas, multiline fields and escaped quotes', () => {
  const r = previewCsvLocally('\uFEFFSymbol,Qty,Note\r\nTCS,"1,000","a ""quoted""\r\nnote"\r\n');
  assert.deepEqual(r.rows[0].cells, ['TCS', '1,000', 'a "quoted"\r\nnote']);
  assert.equal(r.suggestedMapping.tickerColumn, 'Symbol');
});
test('malformed rows or quoting cannot be silently omitted', () => {
  for (const s of ['ticker,qty\nTCS,2,extra', 'ticker,qty\n"TCS,2', 'ticker,qty\n"TCS"x,2', 'ticker,qty\nTC"S,2']) {
    assert.throws(() => previewCsvLocally(s));
  }
});
test('all holding rows remain present even if values need Python validation', () => {
  const r = previewCsvLocally('ticker,qty\nTCS,-2\n?,not-a-number\n');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[1].cells, ['?', 'not-a-number']);
});
test('blank rows are disclosed and source row numbers retained', () => {
  const r = previewCsvLocally('ticker,qty\n\nTCS,2\n , \nINFY,3');
  assert.deepEqual(r.rows.map((x) => x.rowNumber), [3, 5]);
  assert.match(r.note, /2 empty row/);
});
test('headers are unique even with existing numbered names', () => {
  const r = previewCsvLocally('ticker,ticker,ticker (2),\nA,B,C,D');
  assert.equal(new Set(r.columns).size, 4);
  assert.equal(r.columns[3], 'Column 4');
});
test('empty, oversized, too many columns and too many rows fail explicitly', () => {
  for (const s of ['', 'ticker,qty\n', ',\nA,2', 'x'.repeat(80001), `${Array(31).fill('x').join(',')}\n${Array(31).fill('a').join(',')}`, `ticker,qty\n${Array(51).fill('TCS,1').join('\n')}`]) {
    assert.throws(() => previewCsvLocally(s));
  }
});
