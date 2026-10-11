'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isFailure,
  failedRequestIds,
  reportFilename,
  buildReport,
  MIME,
} = require('../collectionReport.js');

const RESULT = {
  results: [
    {
      requestId: 'r1',
      name: 'List users',
      iteration: 1,
      runStatus: 'SUCCESS',
      httpStatus: 200,
      durationMs: 12,
      error: null,
      assertions: [{ passed: true, message: 'ok' }],
    },
    {
      requestId: 'r2',
      name: 'Create user',
      iteration: 2,
      runStatus: 'SUCCESS',
      httpStatus: 400,
      durationMs: 8,
      error: null,
      assertions: [{ passed: false, message: 'expected 201' }],
    },
    {
      requestId: 'r3',
      name: 'Delete user',
      iteration: 2,
      runStatus: 'FAILED',
      httpStatus: 0,
      durationMs: null,
      error: 'ECONNREFUSED',
      assertions: [],
    },
  ],
  summary: { total: 3, passed: 2, failed: 1, assertionsTotal: 2, assertionsPassed: 1 },
};

test('isFailure counts assertion failures and transport errors', () => {
  assert.equal(isFailure(RESULT.results[0]), false);
  assert.equal(isFailure(RESULT.results[1]), true);
  assert.equal(isFailure(RESULT.results[2]), true);
});

test('failedRequestIds returns unique failing ids', () => {
  assert.deepEqual(failedRequestIds(RESULT), ['r2', 'r3']);
  assert.deepEqual(failedRequestIds({ results: [] }), []);
  assert.deepEqual(failedRequestIds(null), []);
});

test('json report is round-trippable', () => {
  const out = buildReport(RESULT, { format: 'json' });
  assert.equal(JSON.parse(out).summary.total, 3);
});

test('csv report has a header and one row per result', () => {
  const lines = buildReport(RESULT, { format: 'csv' }).split('\n');
  assert.match(lines[0], /iteration,request,status/);
  assert.equal(lines.length, 4);
  assert.match(lines[1], /List users/);
});

test('junit report escapes and counts failures', () => {
  const out = buildReport(RESULT, { format: 'junit', collectionName: 'Smoke & <test>' });
  assert.match(out, /<testsuites tests="3" failures="2"/);
  assert.match(out, /Smoke &amp; &lt;test&gt;/);
  assert.match(out, /<failure /);
});

test('markdown report includes a summary and table', () => {
  const out = buildReport(RESULT, { format: 'markdown', collectionName: 'Smoke' });
  assert.match(out, /# Collection run — Smoke/);
  assert.match(out, /\| 1 \| List users \|/);
});

test('html report escapes content', () => {
  const out = buildReport(RESULT, { format: 'html', collectionName: 'Smoke' });
  assert.match(out, /<!doctype html>/);
  assert.match(out, /Create user/);
});

test('reportFilename is filesystem-safe and typed', () => {
  assert.equal(reportFilename('My Collection', 'junit', 123), 'collection-run-My-Collection-123.xml');
  assert.equal(reportFilename('', 'markdown', 5), 'collection-run-collection-5.md');
});

test('unknown format falls back to json and mime map is complete', () => {
  assert.doesNotThrow(() => JSON.parse(buildReport(RESULT, { format: 'nope' })));
  assert.deepEqual(Object.keys(MIME).sort(), ['csv', 'html', 'json', 'junit', 'markdown']);
});
