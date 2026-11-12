import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNumber, csvCell, gainLabel, lossLabel } from './simulator-helpers.ts';

test('loss limit validation', () => {
  assert.deepEqual(checkNumber('0', { label: 'L', min: 0, required: true }), { ok: true, value: '0' });
  assert.equal(checkNumber('', { label: 'L', required: true })?.ok, false);
  assert.equal(checkNumber('-1', { label: 'L', min: 0 })?.ok, false);
  assert.equal(checkNumber('abc', { label: 'L' })?.ok, false);
  assert.equal(checkNumber('1e999', { label: 'L' })?.ok, false);
  assert.equal(checkNumber('', { label: 'L' }), null);
  assert.equal(checkNumber('2.5', { label: 'H', integer: true })?.ok, false);
  assert.equal(checkNumber('9'.repeat(400), { label: 'L' })?.ok, false);
  assert.equal(checkNumber('100', { label: 'C', min: 50, max: 99 })?.ok, false);
  assert.equal(checkNumber('49', { label: 'C', min: 50, max: 99 })?.ok, false);
});

test('csv escaping', () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(csvCell(-12.5), '"-12.5"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('-1+SUM(A1)'), `\"'-1+SUM(A1)\"`);
  assert.equal(csvCell(' =SUM(A1)'), `\"' =SUM(A1)\"`);
});

test('signed labels', () => {
  assert.equal(lossLabel(-5), '₹-5 signed loss (negative means gain)');
  assert.match(lossLabel(5), /loss$/);
  assert.equal(gainLabel(-5), '₹-5 signed gain (all sampled outcomes lost)');
  assert.match(gainLabel(-5), /all sampled outcomes lost/);
});
