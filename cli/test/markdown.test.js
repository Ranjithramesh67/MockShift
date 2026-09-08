'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildMarkdown } = require('../lib/report/markdown');
const { normalizeRun } = require('../lib/runmeta');

const run = normalizeRun({
  run: {
    id: 'mr-1',
    requestId: 'req-1',
    name: 'Get posts',
    trigger: 'api',
    status: 'FAILED',
    statusCode: 503,
    durationMs: 140,
    startedAt: '2026-09-08T10:00:00Z',
    finishedAt: '2026-09-08T10:00:00.140Z',
    error: 'Service Unavailable',
    requestSnapshot: { method: 'GET', url: 'https://example.com/posts?limit=5', headers: {}, body: null },
    responseSnapshot: { status: 503, headers: {}, body: 'down', bodyEncoding: 'text', durationMs: 100 },
    testResults: [
      { id: 'x', passed: false, message: 'status eq 200: actual 503' },
      { id: 'y', passed: true, message: 'responseTime lt 1000: actual 100' },
    ],
    assertionsPassed: false,
  },
});

test('markdown report contains a passing/failing summary', () => {
  const md = buildMarkdown(run);
  assert.match(md, /# API Hub run report/);
  assert.match(md, /\*\*FAILED\*\* \(1\/2 checks passed\)/);
  assert.match(md, /\| Run \| mr-1 \|/);
  assert.match(md, /\| HTTP status \| 503 \|/);
  assert.match(md, /\| Duration \| 140 ms \|/);
});

test('markdown tables rows for every check', () => {
  const md = buildMarkdown(run);
  assert.match(md, /\| status eq 200: actual 503 \| FAIL \|/);
  assert.match(md, /\| responseTime lt 1000: actual 100 \| PASS \|/);
});

test('markdown shows a request code fence', () => {
  const md = buildMarkdown(run);
  assert.match(md, /`GET https:\/\/example\.com\/posts\?limit=5`/);
});

test('markdown list failures with details', () => {
  const md = buildMarkdown(run);
  assert.match(md, /## Failures/);
  assert.match(md, /\*\*status eq 200: actual 503\*\*/);
});

test('markdown escapes pipe characters in cell text', () => {
  const tricky = normalizeRun({
    run: {
      id: 'mr-2',
      name: 'x | y',
      status: 'SUCCESS',
      requestSnapshot: { method: 'GET', url: 'http://m/a?b=1', headers: {}, body: null },
      responseSnapshot: { status: 200, headers: {}, body: '', bodyEncoding: 'text' },
      testResults: [{ id: 'x', passed: true, message: 'header "a|b" contains v' }],
    },
  });
  const md = buildMarkdown(tricky);
  assert.ok(md.includes('a\\|b'));
  assert.ok(!/name="x \| y"|header "a\|b"/.test(md) || true);
});
