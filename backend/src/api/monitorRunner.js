'use strict';

// ============================================================================
// Monitor runner — E2 API monitoring & alerting.
//
// Executes *due* monitors (one cron-scheduled synthetic check each), records a
// `monitor_results` row, maintains pass/fail streak counters and fires alerts
// when the failure threshold is crossed / when the target recovers.
//
// Mounted/started by the coordinator in server.js:
//   const { startMonitorScheduler } = require('./monitorRunner');
//   startMonitorScheduler();
//
// Safety: nothing here starts a timer at module import. Tests call
// `runDueMonitors({ now })` directly with a faked clock, and webhook delivery
// accepts an injected `fetchImpl` so tests can point at a local throwaway
// server (never the public internet).
// ============================================================================

const { query } = require('./db');
const { runRequest } = require('./runner');

// How far back `previousCronOccurrence` will search for the most recent
// scheduled minute. 8 days covers the common short cycles (minutely..weekly)
// without an unbounded loop.
const CRON_LOOKBACK_MINUTES = 8 * 24 * 60;
const WEBHOOK_TIMEOUT_MS = 10000;
const WORKFLOW_POLL_TIMEOUT_MS = 30000;
const WORKFLOW_POLL_INTERVAL_MS = 500;

// ------------------------------------------------------------- cron helpers

function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of String(field).split(',')) {
    if (!part) return null;
    let range = part;
    let step = 1;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      range = part.slice(0, slash);
      const stepStr = part.slice(slash + 1);
      if (!/^\d+$/.test(stepStr) || Number(stepStr) < 1) return null;
      step = Number(stepStr);
    }
    let lo;
    let hi;
    if (range === '*' || range === '?') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
      lo = Number(a);
      hi = Number(b);
    } else {
      if (!/^\d+$/.test(range)) return null;
      lo = Number(range);
      hi = lo;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

// Parse a standard 5-field cron into sets of allowed values. Returns null when
// the expression is malformed. Day-of-week accepts 0..7 (7 = Sunday).
function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  const minuteSet = parseCronField(minute, 0, 59);
  const hourSet = parseCronField(hour, 0, 23);
  const domSet = parseCronField(dom, 1, 31);
  const monthSet = parseCronField(month, 1, 12);
  const dowSet = parseCronField(dow, 0, 7);
  if (!minuteSet || !hourSet || !domSet || !monthSet || !dowSet) return null;
  if (dowSet.has(7)) {
    dowSet.delete(7);
    dowSet.add(0);
  }
  return {
    minute: minuteSet,
    hour: hourSet,
    dayOfMonth: domSet,
    month: monthSet,
    dayOfWeek: dowSet,
    domRestricted: dom !== '*' && dom !== '?',
    dowRestricted: dow !== '*' && dow !== '?',
  };
}

function isValidCron(expr) {
  return parseCron(expr) !== null;
}

// Vixie-cron semantics: when both day-of-month and day-of-week are restricted
// the check matches if EITHER matches; otherwise both must match.
function cronMatches(expr, date) {
  const cron = typeof expr === 'string' ? parseCron(expr) : expr;
  if (!cron) return false;
  if (!cron.minute.has(date.getUTCMinutes())) return false;
  if (!cron.hour.has(date.getUTCHours())) return false;
  if (!cron.month.has(date.getUTCMonth() + 1)) return false;
  const domOk = cron.dayOfMonth.has(date.getUTCDate());
  const dowOk = cron.dayOfWeek.has(date.getUTCDay());
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

// Most recent scheduled minute at/before `now`, or null when none is found in
// the lookback window.
function previousCronOccurrence(expr, now, maxLookbackMinutes = CRON_LOOKBACK_MINUTES) {
  const cron = parseCron(expr);
  if (!cron) return null;
  const base = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    0,
    0
  ));
  for (let i = 0; i <= maxLookbackMinutes; i += 1) {
    const candidate = new Date(base.getTime() - i * 60000);
    if (cronMatches(cron, candidate)) return candidate;
  }
  return null;
}

function isMonitorDue(monitor, now) {
  if (!monitor.enabled) return false;
  const latest = previousCronOccurrence(monitor.schedule_cron, now);
  if (!latest) return false;
  if (!monitor.last_checked_at) return true;
  return latest.getTime() > new Date(monitor.last_checked_at).getTime();
}

// --------------------------------------------------------------- execution

function startedIso(now) {
  return new Date(now).toISOString();
}

// Execute one monitor target and normalise the outcome to
// `{ passed, httpStatus, durationMs, error }`. Never throws.
async function executeMonitorTarget(monitor) {
  if (monitor.target_type === 'WORKFLOW') {
    return executeWorkflowTarget(monitor);
  }
  return executeRequestTarget(monitor);
}

async function executeRequestTarget(monitor) {
  const started = Date.now();
  try {
    const result = await runRequest(monitor.request_id, monitor.created_by || null);
    const httpStatus = Number(result.httpStatus) || 0;
    const durationMs =
      result.response && Number.isFinite(result.response.durationMs)
        ? result.response.durationMs
        : Date.now() - started;
    const passed = result.runStatus === 'SUCCESS' && httpStatus > 0 && httpStatus < 400 && !result.error;
    return {
      passed,
      httpStatus: httpStatus || null,
      durationMs,
      error: result.error || (passed ? null : `Request finished with status ${result.runStatus}`),
    };
  } catch (err) {
    return {
      passed: false,
      httpStatus: null,
      durationMs: Date.now() - started,
      error: String(err.message || err),
    };
  }
}

async function waitForWorkflowRun(runId) {
  const deadline = Date.now() + WORKFLOW_POLL_TIMEOUT_MS;
  for (;;) {
    const { rows } = await query(`SELECT status FROM run_history WHERE id = $1`, [runId]);
    const status = rows[0] && rows[0].status;
    if (status && status !== 'PENDING' && status !== 'RUNNING') return status;
    if (Date.now() >= deadline) return status || 'PENDING';
    await new Promise((resolve) => setTimeout(resolve, WORKFLOW_POLL_INTERVAL_MS));
  }
}

async function executeWorkflowTarget(monitor) {
  const started = Date.now();
  try {
    // Required lazily: workflowService opens Redis/BullMQ connections on first
    // use, so request-only deployments/tests never touch it.
    const { runWorkflow } = require('./workflowService');
    const runId = await runWorkflow({
      workflowId: monitor.workflow_id,
      trigger: 'CRON',
      inputVars: {},
      userId: monitor.created_by || null,
    });
    const status = runId ? await waitForWorkflowRun(runId) : 'PENDING';
    const passed = status === 'SUCCESS';
    return {
      passed,
      httpStatus: null,
      durationMs: Date.now() - started,
      error: passed ? null : `Workflow finished with status ${status}`,
    };
  } catch (err) {
    return {
      passed: false,
      httpStatus: null,
      durationMs: Date.now() - started,
      error: String(err.message || err),
    };
  }
}

// ---------------------------------------------------------------- alerting

// In-app notification, same shape/persistence as the docs `notifyUser` helper.
async function notifyUser({ userId, title, body, kind, link }) {
  if (!userId) return;
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind, link) VALUES ($1, $2, $3, $4, $5)`,
      [userId, title, body || null, kind || 'info', link || null]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[monitors] notification insert failed:', err.message);
  }
}

async function deliverWebhook(url, payload, fetchImpl) {
  try {
    const doFetch = fetchImpl || globalThis.fetch;
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return { ok: Boolean(res && res.ok), status: res ? res.status : null };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function alertPayload(event, monitor, check, now) {
  return {
    event,
    monitor: {
      id: monitor.id,
      name: monitor.name,
      projectId: monitor.project_id,
      targetType: monitor.target_type,
      requestId: monitor.request_id,
      workflowId: monitor.workflow_id,
      status: monitor.status,
      failureThreshold: monitor.failure_threshold,
      consecutiveFailures: monitor.consecutive_failures,
      consecutiveSuccesses: monitor.consecutive_successes,
    },
    check: {
      passed: check.passed,
      httpStatus: check.httpStatus,
      durationMs: check.durationMs,
      error: check.error,
    },
    firedAt: startedIso(now),
  };
}

async function fireAlerts(event, monitor, check, now, fetchImpl) {
  const label = event === 'recovered' ? 'recovered' : 'is failing';
  const title = `Monitor "${monitor.name}" ${event === 'recovered' ? 'recovered' : 'failed'}`;
  const body =
    event === 'recovered'
      ? `"${monitor.name}" is passing again after ${monitor.consecutive_successes || 1} successful check(s).`
      : `"${monitor.name}" failed ${monitor.consecutive_failures} time(s) in a row` +
        (check.error ? `: ${check.error}` : check.httpStatus ? ` (HTTP ${check.httpStatus}).` : '.');

  const deliveries = [];
  if (monitor.created_by) {
    await notifyUser({
      userId: monitor.created_by,
      title,
      body,
      kind: event === 'recovered' ? 'success' : 'error',
      link: `/monitors?m=${encodeURIComponent(monitor.id)}`,
    });
    deliveries.push('in_app');
  }
  if (monitor.notify_webhook_url) {
    const result = await deliverWebhook(
      monitor.notify_webhook_url,
      alertPayload(event, monitor, check, now),
      fetchImpl
    );
    deliveries.push(result.ok ? 'webhook' : 'webhook_failed');
  }
  return { event, label, title, deliveries };
}

// ----------------------------------------------------------- state machine

// Persist a check result + update streak/status/alert state, firing alerts as
// needed. Mutates `monitor` in place so callers see the fresh counters.
async function recordCheck(monitor, check, { now, fetchImpl } = {}) {
  const checkedAt = startedIso(now || new Date());
  const failed = !check.passed;

  await query(
    `INSERT INTO monitor_results (monitor_id, status, http_status, duration_ms, error, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      monitor.id,
      check.passed ? 'PASS' : 'FAIL',
      check.httpStatus == null ? null : check.httpStatus,
      check.durationMs == null ? null : Math.round(check.durationMs),
      check.error || null,
      checkedAt,
    ]
  );

  const previousFailures = monitor.consecutive_failures || 0;
  const previousSuccesses = monitor.consecutive_successes || 0;
  const failures = failed ? previousFailures + 1 : 0;
  const successes = failed ? 0 : previousSuccesses + 1;
  const status = failed ? 'DOWN' : 'UP';
  const threshold = monitor.failure_threshold || 1;
  const wasAlerted = Boolean(monitor.alerted);

  const events = [];
  let alerted = wasAlerted;
  if (failed && !wasAlerted && failures >= threshold) {
    alerted = true;
    events.push('failed');
  } else if (!failed && wasAlerted) {
    alerted = false;
    events.push('recovered');
  }

  await query(
    `UPDATE monitors
        SET status = $1, consecutive_failures = $2, consecutive_successes = $3,
            alerted = $4, last_checked_at = $5, updated_at = now()
      WHERE id = $6`,
    [status, failures, successes, alerted, checkedAt, monitor.id]
  );

  monitor.status = status;
  monitor.consecutive_failures = failures;
  monitor.consecutive_successes = successes;
  monitor.alerted = alerted;
  monitor.last_checked_at = checkedAt;

  const alerts = [];
  for (const event of events) {
    alerts.push(await fireAlerts(event, monitor, check, now || new Date(), fetchImpl));
  }
  return alerts;
}

// --------------------------------------------------------------- public API

// Execute one already-loaded monitor row regardless of its schedule (used by
// the manual "check now" route). Returns null for an unknown id.
async function runMonitorById({ monitorId, now = new Date(), fetchImpl } = {}) {
  const { rows } = await query(`SELECT * FROM monitors WHERE id = $1`, [monitorId]);
  const monitor = rows[0];
  if (!monitor) return null;
  const check = await executeMonitorTarget(monitor);
  const alerts = await recordCheck(monitor, check, { now, fetchImpl });
  return { monitor, check, alerts };
}

// Find every enabled monitor whose schedule is due at `now` and run it.
// `now` and `fetchImpl` are injectable for deterministic tests.
async function runDueMonitors(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const fetchImpl = options.fetchImpl;

  const { rows } = await query(`SELECT * FROM monitors WHERE enabled = true`);
  const summary = { at: startedIso(now), checked: 0, passed: 0, failed: 0, skipped: 0, alerts: 0 };

  for (const monitor of rows) {
    if (!isMonitorDue(monitor, now)) {
      summary.skipped += 1;
      continue;
    }
    const check = await executeMonitorTarget(monitor);
    const alerts = await recordCheck(monitor, check, { now, fetchImpl });
    summary.checked += 1;
    if (check.passed) summary.passed += 1;
    else summary.failed += 1;
    summary.alerts += alerts.length;
  }
  return summary;
}

// Start the polling scheduler. MUST only be called by the coordinator at
// runtime — importing this module never starts a timer. Returns a handle with
// `stop()`; safe to call more than once (idempotent).
let schedulerTimer = null;
let schedulerRunning = false;

function startMonitorScheduler({ intervalMs = 60000, logger = console } = {}) {
  if (schedulerTimer) return { stop: stopMonitorScheduler };
  schedulerTimer = setInterval(async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const summary = await runDueMonitors();
      if (summary.checked > 0 && logger && typeof logger.log === 'function') {
        logger.log(
          `[monitors] checked ${summary.checked} monitor(s): ${summary.passed} up, ${summary.failed} down, ${summary.alerts} alert(s)`
        );
      }
    } catch (err) {
      if (logger && typeof logger.error === 'function') {
        logger.error('[monitors] scheduler run failed:', err.message);
      }
    } finally {
      schedulerRunning = false;
    }
  }, intervalMs);
  if (schedulerTimer.unref) schedulerTimer.unref();
  return { stop: stopMonitorScheduler };
}

function stopMonitorScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  runDueMonitors,
  runMonitorById,
  startMonitorScheduler,
  stopMonitorScheduler,
  executeMonitorTarget,
  isMonitorDue,
  cronMatches,
  parseCron,
  isValidCron,
  previousCronOccurrence,
};
