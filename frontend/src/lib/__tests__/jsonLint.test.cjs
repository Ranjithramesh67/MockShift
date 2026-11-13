'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jsonLintDiagnostics } = require('../jsonLint');

test('valid JSON has no diagnostics', () => {
  assert.deepEqual(jsonLintDiagnostics('{"a": 1}'), []);
});

test('empty or whitespace body is not flagged', () => {
  assert.deepEqual(jsonLintDiagnostics(''), []);
  assert.deepEqual(jsonLintDiagnostics('   \n'), []);
});

test('invalid JSON reports an error diagnostic', () => {
  const diags = jsonLintDiagnostics('{a: 1}');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, 'error');
  assert.ok(diags[0].message);
  assert.equal(typeof diags[0].from, 'number');
});

test('{{env}} placeholders in JSON strings are not flagged', () => {
  assert.deepEqual(jsonLintDiagnostics('{"token": "{{apiKey}}"}'), []);
  assert.deepEqual(jsonLintDiagnostics('{"id": {{user.id}}}'), []);
});
