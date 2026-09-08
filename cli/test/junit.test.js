'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildJunitXml, xmlEscape, seconds } = require('../lib/report/junit');

function serverRun(overrides) {
  return {
    run: {
      id: 'run-1',
      requestId: 'req-1',
      name: 'Get posts',
      trigger: 'api',
      status: 'FAILED',
      statusCode: 500,
      durationMs: 250,
      startedAt: '2026-09-08T10:00:00.000Z',
      finishedAt: '2026-09-08T10:00:00.250Z',
      error: 'boom',
      requestSnapshot: { method: 'GET', url: 'http://mock/posts', headers: {}, body: null },
      responseSnapshot: { status: 500, statusText: 'Internal Server Error', headers: {}, body: 'err', bodyEncoding: 'text', durationMs: 120 },
      testResults: [
        { id: 'a1', passed: true, message: 'status eq 200: actual 200' },
        { id: 'a2', passed: false, message: 'body.data.id eq 1: actual undefined' },
      ],
      assertionsPassed: false,
    },
    ...(overrides || {}),
  };
}

test('junit XML declares a testsuite with the right counts', () => {
  const xml = buildJunitXml(require('../lib/runmeta').normalizeRun(serverRun()));
  assert.match(xml, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<testsuites name="apihub" tests="2" failures="1" errors="0"/);
  assert.match(xml, /<testsuite name="Get posts" tests="2" failures="1" errors="0" skipped="0"/);
  assert.match(xml, /time="0\.250"/);
});

test('failed testcases become failure elements', () => {
  const xml = buildJunitXml(require('../lib/runmeta').normalizeRun(serverRun()));
  assert.ok(xml.includes('<failure message="body.data.id eq 1: actual undefined" type="request">'));
  const passedCount = (xml.match(/<testcase /g) || []).length;
  assert.strictEqual(passedCount, 2);
});

test('xmlEscape escapes reserved characters', () => {
  assert.strictEqual(xmlEscape('a & b < c > d " q \' z'), 'a &amp; b &lt; c &gt; d &quot; q &apos; z');
});

test('xmlEscape strips control characters illegal in XML 1.0', () => {
  assert.strictEqual(xmlEscape('a\x00b\x08c'), 'abc');
  assert.ok(!xmlEscape('a\x01b').includes('\x01'));
});

test('all-passing run has no failure elements', () => {
  const payload = serverRun();
  payload.run.status = 'SUCCESS';
  payload.run.statusCode = 200;
  payload.run.testResults = [
    { id: 'a1', passed: true, message: 'status eq 200: actual 200' },
    { id: 'a2', passed: true, message: 'body.data.id eq 1: actual 1' },
  ];
  payload.run.assertionsPassed = true;
  const xml = buildJunitXml(require('../lib/runmeta').normalizeRun(payload));
  assert.ok(!xml.includes('<failure'));
  assert.match(xml, /failures="0"/);
});

test('seconds formats duration in seconds with ms precision', () => {
  assert.strictEqual(seconds(250), '0.250');
  assert.strictEqual(seconds(null), '0.000');
  assert.strictEqual(seconds(0), '0.000');
});

test('run without assertions synthesizes one testcase', () => {
  const payload = {
    run: {
      id: 'run-2',
      requestId: 'req-2',
      name: 'No assertions',
      status: 'SUCCESS',
      statusCode: 204,
      durationMs: 10,
      requestSnapshot: { method: 'DELETE', url: 'http://mock/x' },
      responseSnapshot: { status: 204, headers: {}, body: '', bodyEncoding: 'text' },
      testResults: [],
    },
  };
  const xml = buildJunitXml(require('../lib/runmeta').normalizeRun(payload));
  assert.match(xml, /tests="1" failures="0"/);
  assert.ok(xml.includes('DELETE http://mock/x'));
});
