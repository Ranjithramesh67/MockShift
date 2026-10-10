'use strict';

// Tiny result collector: every check reports pass/fail/warn with a detail
// string. run-all prints a summary and writes JSON + Markdown artifacts.

function createReport() {
  const results = [];
  const push = (status, id, detail) => results.push({ id, status, detail: detail == null ? '' : String(detail) });
  return {
    results,
    pass: (id, detail) => push('pass', id, detail),
    fail: (id, detail) => push('fail', id, detail),
    warn: (id, detail) => push('warn', id, detail),
    counts() {
      const c = { pass: 0, fail: 0, warn: 0 };
      for (const r of results) c[r.status] += 1;
      return c;
    },
  };
}

function renderSummary(report) {
  const c = report.counts();
  const lines = [];
  lines.push('');
  for (const r of report.results) {
    const mark = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'WARN';
    lines.push(`  [${mark}] ${r.id}${r.detail ? ` - ${r.detail}` : ''}`);
  }
  lines.push('');
  lines.push(`  total=${report.results.length}  pass=${c.pass}  fail=${c.fail}  warn=${c.warn}`);
  return lines.join('\n');
}

module.exports = { createReport, renderSummary };
