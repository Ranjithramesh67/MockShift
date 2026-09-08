'use strict';

function unwrapRun(payload) {
  if (payload === null || typeof payload !== 'object') return null;
  if (payload.run && typeof payload.run === 'object') return payload.run;
  return payload;
}

function okStatus(status) {
  const s = String(status || '').toUpperCase();
  return s === 'SUCCESS' || s === 'PASSED' || s === 'OK';
}

function hasUsableBody(value) {
  return value === null || value === undefined ? false : value.body !== undefined || value.status !== undefined;
}

function normalizeTestCases(run) {
  if (Array.isArray(run.testResults) && run.testResults.length > 0) {
    return run.testResults.map((t) => ({
      name: t && typeof t.message === 'string' ? t.message : String((t && t.id) || 'assertion'),
      passed: Boolean(t && t.passed),
      detail: t && typeof t.message === 'string' ? t.message : null,
    }));
  }
  if (Array.isArray(run.test_results) && run.test_results.length > 0) {
    return run.test_results.map((t) => ({
      name: t && typeof t.test_name === 'string' ? t.test_name : String((t && t.test_name) || 'assertion'),
      passed: Boolean(t && t.passed),
      detail:
        t && t.error
          ? String(t.error)
          : t && t.assertions
            ? JSON.stringify(t.assertions)
            : null,
    }));
  }
  return [];
}

function bodySize(response) {
  if (!response || typeof response.body !== 'string') return 0;
  if (response.bodyEncoding === 'base64') {
    return Math.floor((response.body.length * 3) / 4);
  }
  return Buffer.byteLength(response.body, 'utf8');
}

function normalizeRun(payload) {
  const run = unwrapRun(payload);
  if (!run) return null;
  const isHistory = !('startedAt' in run) && ('started_at' in run || 'request_snapshot' in run);

  const requestSnapshot = run.requestSnapshot || run.request_snapshot || null;
  const responseSnapshot = run.responseSnapshot || run.response_snapshot || null;

  const testCases = normalizeTestCases(run);
  const hadChecks = testCases.length > 0;

  let assertionsPassed;
  if (typeof run.assertionsPassed === 'boolean') {
    assertionsPassed = run.assertionsPassed;
  } else if (hadChecks) {
    assertionsPassed = testCases.every((t) => t.passed);
  } else {
    assertionsPassed = true;
  }

  if (testCases.length === 0) {
    testCases.push({
      name: requestSnapshot
        ? `${requestSnapshot.method || 'GET'} ${requestSnapshot.url || run.name || 'request'}`
        : run.name || `run ${run.id || ''}`,
      passed: okStatus(run.status),
      detail: run.error ? String(run.error) : null,
    });
  }

  const startedAt = run.startedAt || run.started_at || null;
  const finishedAt = run.finishedAt || run.finished_at || null;
  let durationMs = run.durationMs !== undefined ? run.durationMs : null;
  if (durationMs === null && startedAt && finishedAt) {
    durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  }
  if (durationMs === null && responseSnapshot && responseSnapshot.durationMs !== undefined) {
    durationMs = responseSnapshot.durationMs;
  }

  let statusCode = run.statusCode !== undefined ? run.statusCode : null;
  if ((statusCode === null || statusCode === undefined) && responseSnapshot) {
    statusCode = responseSnapshot.status !== undefined ? responseSnapshot.status : null;
  }

  return {
    id: run.id || run.runId || null,
    name: run.name || null,
    trigger: run.trigger || null,
    status: run.status || 'FAILED',
    statusCode: statusCode === undefined ? null : statusCode,
    durationMs,
    startedAt,
    finishedAt,
    error: run.error || null,
    request: requestSnapshot,
    response: responseSnapshot,
    responseBytes: bodySize(responseSnapshot),
    testCases,
    assertionsPassed,
    isHistory,
    hadChecks,
    hasUsableResponse: hasUsableBody(responseSnapshot),
  };
}

function countSummary(run) {
  const total = run.testCases.length;
  const passed = run.testCases.filter((t) => t.passed).length;
  const failed = total - passed;
  return { total, passed, failed };
}

async function fetchRunById(client, runId) {
  const res = await client.get(`/api/history/${encodeURIComponent(runId)}`);
  return normalizeRun(res.body);
}

module.exports = { normalizeRun, unwrapRun, okStatus, countSummary, fetchRunById };
