'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { completionsFor, formulaCompletionSource, FORMULA_COMPLETIONS } = require('../formulaCompletions');

test('top-level completions expose sandbox globals and JS built-ins', () => {
  const labels = FORMULA_COMPLETIONS.map((c) => c.label);
  for (const expected of ['req', '$vars', '$utils', 'JSON', 'Object', 'Math']) {
    assert.ok(labels.includes(expected), `missing ${expected}`);
  }
});

test('req. suggests request properties', () => {
  const labels = completionsFor('req.').map((c) => c.label);
  assert.ok(labels.includes('body'));
  assert.ok(labels.includes('headers'));
});

test('$utils. suggests utility helpers', () => {
  const labels = completionsFor('$utils.').map((c) => c.label);
  assert.ok(labels.includes('uuid'));
  assert.ok(labels.includes('now'));
});

test('explicit completion after a bare dot returns options', () => {
  const context = { pos: 4, explicit: false, matchBefore: () => ({ from: 0, to: 4, text: 'req.' }) };
  const result = formulaCompletionSource(context);
  assert.ok(result);
  assert.equal(result.from, 4);
  assert.ok(result.options.some((o) => o.label === 'body'));
});

test('no match and not explicit returns null', () => {
  const context = { pos: 0, explicit: false, matchBefore: () => null };
  assert.equal(formulaCompletionSource(context), null);
});
