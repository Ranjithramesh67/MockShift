'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeRun, unwrapRun, countSummary, okStatus } = require('../lib/runmeta');

test('unwrapRun extracts the run object from a server response', () => {
  assert.deepStrictEqual(unwrapRun({ run: { id: 'x' } }), { id: 'x' });
  assert.deepStrictEqual(unwrapRun({ id: 'y' }), { id: 'y' });
  assert.strictEqual(unwrapRun(null), null);
});

test('normalizes a server-side run (S5 shape)', () => {
  const run = normalizeRun({
    run: {
      id: 'r1',
      requestId: 'req1',
      name: 'Get posts',
      status: 'FAILED',
      statusCode: 500,
      durationMs: 120,
      startedAt: '2026-09-08T10:00:00Z',
      finishedAt: '2026-09-08T10:00:00.120Z',
      error: null,
      requestSnapshot: { method: 'GET', url: 'http://m/posts', headers: {}, body: null },
      responseSnapshot: { status: 500, headers: {}, body: 'boom', bodyEncoding: 'text', durationMs: 100 },
      testResults: [
        { id: 'x', passed: false, message: 'status eq 200: actual 500' },
        { id: 'y', passed: true, message: 'responseTime lt 1000: actual 100' },
      ],
      assertionsPassed: false,
    },
  });
  assert.strictEqual(run.id, 'r1');
  assert.strictEqual(run.status, 'FAILED');
  assert.strictEqual(run.statusCode, 500);
  assert.strictEqual(run.durationMs, 120);
  assert.strictEqual(run.hadChecks, true);
  assert.strictEqual(run.assertionsPassed, false);
  assert.strictEqual(run.responseBytes, 4);
  assert.strictEqual(run.testCases.length, 2);
  assert.strictEqual(run.testCases[0].passed, false);
  assert.strictEqual(run.testCases[1].passed, true);
});

test('normalizes a history run shape (GET /api/history/:id)', () => {
  const run = normalizeRun({
    run: {
      id: 'r2',
      name: 'Get posts',
      trigger: 'api',
      status: 'SUCCESS',
      started_at: '2026-09-08T10:00:00Z',
      finished_at: '2026-09-08T10:00:00.100Z',
      request_id: 'req1',
      request_snapshot: { method: 'GET', url: 'http://m/posts', headers: {}, body: null },
      response_snapshot: { status: 200, headers: {}, body: '{"ok":true}', bodyEncoding: 'text', durationMs: 60 },
      test_results: [
        { test_name: 'status eq 200', passed: true, assertions: null, error: null },
        { test_name: 'body.ok eq true', passed: false, assertions: '{}', error: 'actual undefined' },
      ],
    },
  });
  assert.strictEqual(run.status, 'SUCCESS');
  assert.strictEqual(run.statusCode, 200);
  assert.strictEqual(run.isHistory, true);
  assert.strictEqual(run.durationMs, 100);
  assert.strictEqual(run.testCases.length, 2);
  assert.strictEqual(run.testCases[0].name, 'status eq 200');
  assert.strictEqual(run.testCases[1].detail, 'actual undefined');
  assert.strictEqual(run.assertionsPassed, false);
});

test('duration is derived from timestamps when missing', () => {
  const run = normalizeRun({
    run: {
      id: 'r3',
      name: 'x',
      status: 'SUCCESS',
      startedAt: '2026-09-08T10:00:00Z',
      finishedAt: '2026-09-08T10:00:00.500Z',
    },
  });
  assert.strictEqual(run.durationMs, 500);
});

test('synthesizes a single testcase when the run has no assertions', () => {
  const run = normalizeRun({
    run: {
      id: 'r4',
      name: 'Ping',
      status: 'SUCCESS',
      statusCode: 204,
      requestSnapshot: { method: 'HEAD', url: 'http://m/x' },
      testResults: [],
    },
  });
  assert.strictEqual(run.hadChecks, false);
  assert.strictEqual(run.testCases.length, 1);
  assert.strictEqual(run.testCases[0].passed, true);
  assert.strictEqual(run.assertionsPassed, true);
});

test('countSummary totals pass/fail', () => {
  const run = normalizeRun({
    run: {
      id: 'r5',
      name: 'x',
      status: 'FAILED',
      testResults: [
        { passed: true, message: 'a' },
        { passed: false, message: 'b' },
        { passed: true, message: 'c' },
      ],
    },
  });
  assert.deepStrictEqual(countSummary(run), { total: 3, passed: 2, failed: 1 });
});

test('base64 response bytes are decoded to approximate size', () => {
  const payload = Buffer.from('hello world').toString('base64');
  const run = normalizeRun({
    run: {
      id: 'r6',
      name: 'x',
      status: 'SUCCESS',
      requestSnapshot: {},
      responseSnapshot: { status: 200, body: payload, bodyEncoding: 'base64' },
      testResults: [],
    },
  });
  assert.ok(run.responseBytes >= 10 && run.responseBytes <= 12);
});

test('okStatus recognises success variants', () => {
  assert.strictEqual(okStatus('SUCCESS'), true);
  assert.strictEqual(okStatus('PASSED'), true);
  assert.strictEqual(okStatus('FAILED'), false);
  assert.strictEqual(okStatus(''), false);
});
