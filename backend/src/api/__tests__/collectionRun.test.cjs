'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LIMITS,
  normalizeRunOptions,
  normalizeDataRows,
  flattenRow,
  buildRunPlan,
  runItemFailed,
  summarizeRun,
} = require('../collectionRun');

test('normalizeRunOptions applies safe defaults', () => {
  assert.deepEqual(normalizeRunOptions(undefined), {
    stopOnError: false,
    delayMs: 0,
    retries: 0,
    iterations: 1,
    requestIds: [],
    data: [],
  });
});

test('normalizeRunOptions clamps and coerces client values', () => {
  const o = normalizeRunOptions({
    stopOnError: true,
    delayMs: 99999,
    retries: -4,
    iterations: 3.9,
    requestIds: ['a', 'a', '', 7, 'b'],
  });
  assert.equal(o.stopOnError, true);
  assert.equal(o.delayMs, LIMITS.maxDelayMs);
  assert.equal(o.retries, 0);
  assert.equal(o.iterations, 3);
  assert.deepEqual(o.requestIds, ['a', 'b']);
});

test('normalizeDataRows drops non-objects and stringifies values', () => {
  const rows = normalizeDataRows([{ a: 1, b: true, c: null }, 'nope', ['x'], { d: { nested: 1 } }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { a: '1', b: 'true', c: '' });
  assert.equal(rows[1].d, '{"nested":1}');
});

test('normalizeDataRows caps the row count', () => {
  const big = Array.from({ length: LIMITS.maxDataRows + 50 }, (_, i) => ({ i }));
  assert.equal(normalizeDataRows(big).length, LIMITS.maxDataRows);
});

test('flattenRow exposes both namespaced and bare keys', () => {
  assert.deepEqual(flattenRow({ email: 'a@b.io' }), { 'data.email': 'a@b.io', email: 'a@b.io' });
  assert.deepEqual(flattenRow(null), {});
});

test('buildRunPlan crosses every data row with every request', () => {
  const requests = [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }];
  const options = normalizeRunOptions({ data: [{ n: 1 }, { n: 2 }] });
  const plan = buildRunPlan(requests, options);
  assert.equal(plan.length, 4);
  assert.equal(plan[0].iteration, 1);
  assert.equal(plan[2].iteration, 2);
  assert.deepEqual(plan[2].extraVars, { 'data.n': '2', n: '2' });
});

test('buildRunPlan repeats the collection when there is no data', () => {
  const requests = [{ id: 'r1', name: 'A' }];
  const plan = buildRunPlan(requests, normalizeRunOptions({ iterations: 3 }));
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.iteration), [1, 2, 3]);
  assert.equal(plan[0].row, null);
});

test('runItemFailed treats assertion failures as failures', () => {
  assert.equal(runItemFailed({ runStatus: 'SUCCESS', assertions: [] }), false);
  assert.equal(runItemFailed({ runStatus: 'SUCCESS', assertions: [{ passed: false }] }), true);
  assert.equal(runItemFailed({ runStatus: 'FAILED', assertions: [] }), true);
  assert.equal(runItemFailed(null), true);
});

test('summarizeRun aggregates counts and echoes run metadata', () => {
  const summary = summarizeRun(
    [
      { runStatus: 'SUCCESS', assertions: [{ passed: true }, { passed: true }] },
      { runStatus: 'SUCCESS', assertions: [{ passed: false }] },
      { runStatus: 'FAILED', assertions: [] },
    ],
    { iterations: 2, dataRows: 2, stoppedEarly: true }
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.assertionsTotal, 3);
  assert.equal(summary.assertionsPassed, 2);
  assert.equal(summary.checksFailed, 2);
  assert.equal(summary.stoppedEarly, true);
  assert.equal(summary.dataRows, 2);
});
