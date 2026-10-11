'use strict';

// Turn a Collection Runner result into a downloadable QA report. Pure +
// CommonJS so it can be unit tested and reused by the runner modal.

const MIME = {
  json: 'application/json',
  junit: 'application/xml',
  csv: 'text/csv',
  markdown: 'text/markdown',
  html: 'text/html',
};

function esc(value) {
  return String(value == null ? '' : value);
}

function xmlEsc(value) {
  return esc(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlEsc(value) {
  return esc(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(value) {
  const s = esc(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isFailure(item) {
  if (!item) return true;
  if (item.runStatus !== 'SUCCESS') return true;
  return Array.isArray(item.assertions) && item.assertions.some((a) => !a.passed);
}

function failureDetail(item) {
  const failed = (item.assertions || []).filter((a) => !a.passed).map((a) => a.message);
  if (failed.length) return failed.join('; ');
  return item.error || `HTTP ${item.httpStatus}`;
}

// Unique request ids that had at least one failed execution, so the UI can
// offer a "re-run failures only" action.
function failedRequestIds(result) {
  const ids = [];
  const seen = new Set();
  for (const item of (result && result.results) || []) {
    if (!isFailure(item) || seen.has(item.requestId)) continue;
    seen.add(item.requestId);
    ids.push(item.requestId);
  }
  return ids;
}

function totalDurationMs(result) {
  return ((result && result.results) || []).reduce((n, r) => n + (Number(r.durationMs) || 0), 0);
}

function buildJson(result) {
  return JSON.stringify(result, null, 2);
}

function buildCsv(result) {
  const lines = ['iteration,request,status,http_status,duration_ms,assertions_passed,assertions_total,error'];
  for (const item of (result && result.results) || []) {
    const assertions = item.assertions || [];
    lines.push(
      [
        item.iteration == null ? '' : item.iteration,
        item.name,
        item.runStatus,
        item.httpStatus,
        item.durationMs == null ? '' : item.durationMs,
        assertions.filter((a) => a.passed).length,
        assertions.length,
        item.error || '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

function buildJunit(result, collectionName) {
  const items = (result && result.results) || [];
  const failures = items.filter(isFailure).length;
  const time = (totalDurationMs(result) / 1000).toFixed(3);
  const cases = items
    .map((item) => {
      const name = `${esc(item.name)}${item.iteration ? ` [iteration ${item.iteration}]` : ''}`;
      const seconds = ((Number(item.durationMs) || 0) / 1000).toFixed(3);
      const open = `    <testcase classname="collection" name="${xmlEsc(name)}" time="${seconds}">`;
      if (!isFailure(item)) return `${open}</testcase>`;
      return (
        `${open}\n` +
        `      <failure message="${xmlEsc(failureDetail(item))}">${xmlEsc(failureDetail(item))}</failure>\n` +
        `    </testcase>`
      );
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites tests="${items.length}" failures="${failures}" time="${time}">\n` +
    `  <testsuite name="${xmlEsc(collectionName || 'Collection')}" tests="${items.length}" failures="${failures}" skipped="0" time="${time}">\n` +
    `${cases}\n` +
    `  </testsuite>\n` +
    `</testsuites>\n`
  );
}

function buildMarkdown(result, collectionName) {
  const s = (result && result.summary) || {};
  const items = (result && result.results) || [];
  const lines = [
    `# Collection run — ${esc(collectionName || 'Collection')}`,
    '',
    `- Requests: **${esc(s.total)}**`,
    `- Passed: **${esc(s.passed)}**`,
    `- Failed: **${esc(s.failed)}**`,
    `- Assertions: **${esc(s.assertionsPassed)}/${esc(s.assertionsTotal)}**`,
  ];
  if (s.stoppedEarly) lines.push('- Run stopped early (stop on error)');
  lines.push('', '| # | Request | Iter | Status | HTTP | ms | Assertions | Error |', '|---|---|---|---|---|---|---|---|');
  items.forEach((item, i) => {
    const assertions = item.assertions || [];
    lines.push(
      `| ${i + 1} | ${esc(item.name)} | ${esc(item.iteration)} | ${esc(item.runStatus)} | ${esc(item.httpStatus)} | ` +
        `${esc(item.durationMs == null ? '' : item.durationMs)} | ${assertions.filter((a) => a.passed).length}/${assertions.length} | ${esc(item.error || '')} |`
    );
  });
  return lines.join('\n');
}

function buildHtml(result, collectionName) {
  const s = (result && result.summary) || {};
  const items = (result && result.results) || [];
  const rows = items
    .map((item) => {
      const bad = isFailure(item);
      const assertions = item.assertions || [];
      return (
        `<tr class="${bad ? 'fail' : 'ok'}">` +
        `<td>${esc(item.iteration)}</td>` +
        `<td>${htmlEsc(item.name)}</td>` +
        `<td>${htmlEsc(item.runStatus)}</td>` +
        `<td>${esc(item.httpStatus)}</td>` +
        `<td>${esc(item.durationMs == null ? '' : item.durationMs)}</td>` +
        `<td>${assertions.filter((a) => a.passed).length}/${assertions.length}</td>` +
        `<td>${htmlEsc(failureDetail(item))}</td>` +
        `</tr>`
      );
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Collection run - ${htmlEsc(collectionName || 'Collection')}</title>
<style>body{font:13px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px}
.cards{display:flex;gap:16px;margin:12px 0}.card{padding:10px 14px;border:1px solid #e5e5e5;border-radius:8px}
table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid #eee;text-align:left}
tr.fail td{background:#fff1f0}th{background:#fafafa}</style></head><body>
<h1>Collection run - ${htmlEsc(collectionName || 'Collection')}</h1>
<div class="cards"><div class="card">Requests <b>${esc(s.total)}</b></div>
<div class="card">Passed <b>${esc(s.passed)}</b></div><div class="card">Failed <b>${esc(s.failed)}</b></div>
<div class="card">Assertions <b>${esc(s.assertionsPassed)}/${esc(s.assertionsTotal)}</b></div></div>
<table><thead><tr><th>#</th><th>Request</th><th>Status</th><th>HTTP</th><th>ms</th><th>Assertions</th><th>Error</th></tr></thead>
<tbody>
${rows}
</tbody></table></body></html>`;
}

function safeName(value) {
  return String(value || 'collection')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'collection';
}

function reportFilename(collectionName, format = 'json', stamp = Date.now()) {
  const ext = format === 'markdown' ? 'md' : format === 'junit' ? 'xml' : format;
  return `collection-run-${safeName(collectionName)}-${stamp}.${ext}`;
}

// Build a report string. `format` is one of json | junit | csv | markdown | html.
function buildReport(result, { format = 'json', collectionName = 'Collection' } = {}) {
  switch (format) {
    case 'junit':
      return buildJunit(result, collectionName);
    case 'csv':
      return buildCsv(result);
    case 'markdown':
      return buildMarkdown(result, collectionName);
    case 'html':
      return buildHtml(result, collectionName);
    case 'json':
    default:
      return buildJson(result);
  }
}

module.exports = {
  MIME,
  isFailure,
  failureDetail,
  failedRequestIds,
  totalDurationMs,
  reportFilename,
  buildReport,
};
