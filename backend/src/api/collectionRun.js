'use strict';

// Pure helpers backing the Collection Runner's QA options: data-driven runs,
// retries, pacing and stop-on-error. Dependency-free so it can be unit tested
// with node:test (see src/api/__tests__/collectionRun.test.cjs).

const LIMITS = {
  maxIterations: 50,
  maxRetries: 5,
  maxDelayMs: 10000,
  maxDataRows: 200,
  maxRequestIds: 500,
  maxValueLength: 2000,
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampInt(raw, { min, max, fallback }) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, LIMITS.maxValueLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value).slice(0, LIMITS.maxValueLength);
  } catch {
    return '';
  }
}

// Accepts an array of flat objects (one per data row) and returns a bounded,
// string-valued copy. Non-object rows are dropped rather than rejected so one
// malformed CSV line cannot abort the whole run.
function normalizeDataRows(raw) {
  if (!Array.isArray(raw)) return [];
  const rows = [];
  for (const row of raw) {
    if (!isPlainObject(row)) continue;
    const clean = {};
    for (const [key, value] of Object.entries(row)) {
      const k = String(key).trim();
      if (!k) continue;
      clean[k] = normalizeCellValue(value);
    }
    rows.push(clean);
    if (rows.length >= LIMITS.maxDataRows) break;
  }
  return rows;
}

// Normalise caller-supplied run options. Every field is optional; malformed
// values fall back to a safe default so a bad payload can never widen a run.
function normalizeRunOptions(body) {
  const b = isPlainObject(body) ? body : {};
  const options = {
    stopOnError: b.stopOnError === true,
    delayMs: clampInt(b.delayMs, { min: 0, max: LIMITS.maxDelayMs, fallback: 0 }),
    retries: clampInt(b.retries, { min: 0, max: LIMITS.maxRetries, fallback: 0 }),
    iterations: clampInt(b.iterations, { min: 1, max: LIMITS.maxIterations, fallback: 1 }),
    requestIds: [],
    data: [],
  };
  if (Array.isArray(b.requestIds)) {
    const seen = new Set();
    for (const id of b.requestIds) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      seen.add(id);
      options.requestIds.push(id);
      if (options.requestIds.length >= LIMITS.maxRequestIds) break;
    }
  }
  options.data = normalizeDataRows(b.data);
  return options;
}

// Flatten a data row into the variable namespace a request template sees, so
// both `{{data.email}}` and `{{email}}` resolve.
function flattenRow(row) {
  const vars = {};
  if (!isPlainObject(row)) return vars;
  for (const [key, value] of Object.entries(row)) {
    const k = String(key);
    vars[`data.${k}`] = value;
    vars[k] = value;
  }
  return vars;
}

// Ordered execution plan: one entry per HTTP call. With data rows the
// collection runs once per row (in row order); otherwise it repeats
// `iterations` times.
function buildRunPlan(requests, options) {
  const plan = [];
  const rows = options.data && options.data.length ? options.data : null;
  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      for (const request of requests) {
        plan.push({ request, iteration: i + 1, row: rows[i], extraVars: flattenRow(rows[i]) });
      }
    }
    return plan;
  }
  const repeats = Math.max(1, options.iterations || 1);
  for (let i = 0; i < repeats; i++) {
    for (const request of requests) {
      plan.push({ request, iteration: i + 1, row: null, extraVars: {} });
    }
  }
  return plan;
}

// A run "fails" when the call errored OR any assertion failed. The runner's
// own `runStatus` only reflects transport success, which is not enough for QA
// reporting.
function runItemFailed(item) {
  if (!item) return true;
  if (item.runStatus !== 'SUCCESS') return true;
  return Array.isArray(item.assertions) && item.assertions.some((a) => !a.passed);
}

function summarizeRun(results, { iterations = 1, dataRows = 0, stoppedEarly = false } = {}) {
  const total = results.length;
  const passed = results.filter((r) => r.runStatus === 'SUCCESS').length;
  const assertionsTotal = results.reduce((n, r) => n + (r.assertions ? r.assertions.length : 0), 0);
  const assertionsPassed = results.reduce(
    (n, r) => n + (r.assertions ? r.assertions.filter((a) => a.passed).length : 0),
    0
  );
  const failed = results.filter(runItemFailed).length;
  return {
    total,
    passed,
    failed: total - passed,
    assertionsTotal,
    assertionsPassed,
    iterations,
    dataRows,
    stoppedEarly,
    checksFailed: failed,
  };
}

module.exports = {
  LIMITS,
  normalizeRunOptions,
  normalizeDataRows,
  flattenRow,
  buildRunPlan,
  runItemFailed,
  summarizeRun,
};
