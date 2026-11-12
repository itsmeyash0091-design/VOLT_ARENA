import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Exchange, PortfolioHolding, ReplayWindowResult, RiskInstrumentCoverage } from '@workspace/api-client-react';
import { recoveryText, scopeFor } from './risk-lab-helpers.ts';

const cov = (ticker: string, dataType: RiskInstrumentCoverage['dataType']): RiskInstrumentCoverage => ({ ticker, instrumentType: 'stock', dataType, sourceSymbol: null, proxyInstrument: null, coverageStart: null, coverageEnd: null, observationCount: 0, missingAlignedObservations: 0, note: 'Artificial test fixture' });
const win = (over: Partial<ReplayWindowResult>): ReplayWindowResult => ({ id: 'w', name: 'W', startDate: '2020-01-20', endDate: '2020-03-23', status: 'unavailable', coverageStart: null, coverageEnd: null, observationCount: 0, maxDrawdownPct: null, peakValue: null, troughValue: null, troughDate: null, recoveryStatus: 'unavailable', recoveryTradingDays: null, recoveryDate: null, path: [], instruments: [], notes: [], ...over });
const h = (ticker: string, exchange: Exchange = 'NSE'): PortfolioHolding => ({ ticker, exchange, instrumentType: 'stock', quantity: '1' });

test('recovery labels never imply zero', () => {
  assert.equal(recoveryText(win({ recoveryStatus: 'not_recovered' })), 'Not recovered in available history');
  assert.match(recoveryText(win({ recoveryStatus: 'incomplete' })), /^Incomplete/);
  assert.equal(recoveryText(win({ recoveryStatus: 'recovered', recoveryTradingDays: 7 })), '7 trading days');
  assert.equal(recoveryText(win({ recoveryStatus: 'recovered' })), 'Recovered (days not returned)');
  assert.match(recoveryText(win({})), /^Unavailable: no portfolio path/);
});

test('scope matches by order and exchange-distinct rows', () => {
  const w = win({ instruments: [cov('AAA', 'observed'), cov('AAA', 'insufficient')] });
  const r = scopeFor([h('AAA', 'NSE'), h('AAA', 'BSE')], w);
  assert.equal(r.aligned, true);
  assert.deepEqual(r.eligible.map((x) => (x.holding as { exchange: string }).exchange), ['NSE']);
  assert.deepEqual(r.blocked.map((x) => (x.holding as { exchange: string }).exchange), ['BSE']);
});

test('misaligned coverage blocks everything', () => {
  const r = scopeFor([h('AAA'), h('BBB')], win({ instruments: [cov('BBB', 'observed'), cov('AAA', 'observed')] }));
  assert.equal(r.aligned, false);
  assert.equal(r.eligible.length, 0);
});

test('no-drawdown result is not described as missing portfolio history', () => {
  const path = [
    { date: '2020-01-20', portfolioValue: 100, normalizedValueIndex: 100 },
    { date: '2020-01-21', portfolioValue: 101, normalizedValueIndex: 101 },
  ];
  assert.equal(recoveryText(win({ path, maxDrawdownPct: 0 })), 'Not applicable: no drawdown in this window');
  assert.equal(recoveryText(win({ path })), 'Recovery unavailable; see source notes');
});

test('missing coverage rows cannot silently become eligible holdings', () => {
  const result = scopeFor([h('AAA'), h('BBB')], win({ instruments: [cov('AAA', 'observed')] }));
  assert.equal(result.aligned, false);
  assert.equal(result.eligible.length, 0);
  assert.equal(result.blocked.length, 2);
});
