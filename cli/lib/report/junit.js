'use strict';

const { countSummary } = require('../runmeta');

function xmlEscape(input) {
  const value = String(input === null || input === undefined ? '' : input);
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    ) {
      out += ch;
    }
  }
  return out
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function seconds(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '0.000';
  return Math.max(0, Number(ms) / 1000).toFixed(3);
}

function timestamp(iso) {
  if (!iso) return new Date().toISOString();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function buildJunitXml(run) {
  const summary = countSummary(run);
  const total = summary.total;
  const failures = summary.failed;
  const suiteName = run.name || run.id || 'apihub run';
  const suiteTime = seconds(run.durationMs);

  const cases = run.testCases.map((tc) => {
    const attrs =
      `name="${xmlEscape(tc.name)}" classname="${xmlEscape(suiteName)}" time="0.000"`;
    if (tc.passed) {
      return `    <testcase ${attrs}/>`;
    }
    const message = xmlEscape(tc.detail || tc.name);
    const type = tc.passed ? '' : run.statusCode >= 400 ? 'request' : 'assertion';
    return `    <testcase ${attrs}>\n      <failure message="${message}" type="${type}">${message}</failure>\n    </testcase>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="apihub" tests="${total}" failures="${failures}" errors="0" time="${suiteTime}">`,
    `  <testsuite name="${xmlEscape(suiteName)}" tests="${total}" failures="${failures}" errors="0" skipped="0" time="${suiteTime}" timestamp="${xmlEscape(timestamp(run.startedAt))}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

module.exports = { buildJunitXml, xmlEscape, seconds };
