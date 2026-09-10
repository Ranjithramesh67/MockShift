'use strict';

// ============================================================================
// Monitors — E2 API monitoring & alerting HTTP surface.
//
// Mount point (coordinator seam in backend/src/api/server.js):
//   app.use('/api/monitors', require('./routes/monitors'));
//
// A monitor belongs to a project and targets either a stored request
// (targetType=REQUEST) or a workflow (targetType=WORKFLOW). It runs on a
// 5-field cron schedule via monitorRunner; this router only manages monitors
// and exposes their status/history. Access mirrors docs.js: read requires
// project read access, mutations require project EDITOR+.
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, canReadProject, canWriteProject } = require('../access');
const { logAudit } = require('../audit');
const { runMonitorById, isValidCron } = require('../monitorRunner');

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_TYPES = ['REQUEST', 'WORKFLOW'];
const MAX_THRESHOLD = 100;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function toApi(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    targetType: row.target_type,
    requestId: row.request_id,
    workflowId: row.workflow_id,
    scheduleCron: row.schedule_cron,
    failureThreshold: row.failure_threshold,
    notifyWebhookUrl: row.notify_webhook_url,
    enabled: row.enabled,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    consecutiveSuccesses: row.consecutive_successes,
    alerted: row.alerted,
    lastCheckedAt: row.last_checked_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadMonitor(monitorId) {
  if (!isUuid(monitorId)) return null;
  const { rows } = await query(`SELECT * FROM monitors WHERE id = $1`, [monitorId]);
  return rows[0] || null;
}

async function requestInProject(requestId, projectId) {
  if (!isUuid(requestId)) return false;
  const { rows } = await query(
    `SELECT 1 FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
      WHERE ar.id = $1 AND c.project_id = $2`,
    [requestId, projectId]
  );
  return rows.length > 0;
}

async function workflowInProject(workflowId, projectId) {
  if (!isUuid(workflowId)) return false;
  const { rows } = await query(
    `SELECT 1 FROM workflow_chains WHERE id = $1 AND project_id = $2`,
    [workflowId, projectId]
  );
  return rows.length > 0;
}

// Resolve and validate the target fields shared by create/update. Returns
// `{ error }` on failure or `{ requestId, workflowId }`.
async function resolveTarget({ targetType, requestId, workflowId, projectId, existing }) {
  const type = targetType || (existing && existing.target_type);
  if (!TARGET_TYPES.includes(type)) {
    return { error: 'targetType must be REQUEST or WORKFLOW' };
  }
  if (type === 'REQUEST') {
    const rid = requestId !== undefined ? requestId : existing && existing.request_id;
    if (!rid) return { error: 'requestId is required for a REQUEST monitor' };
    if (!(await requestInProject(rid, projectId))) {
      return { error: 'Request not found in this project' };
    }
    return { requestId: rid, workflowId: null };
  }
  const wid = workflowId !== undefined ? workflowId : existing && existing.workflow_id;
  if (!wid) return { error: 'workflowId is required for a WORKFLOW monitor' };
  if (!(await workflowInProject(wid, projectId))) {
    return { error: 'Workflow not found in this project' };
  }
  return { requestId: null, workflowId: wid };
}

function normaliseWebhookUrl(value) {
  const url = String(value == null ? '' : value).trim();
  if (!url) return { url: null };
  if (!/^https?:\/\//i.test(url)) return { error: 'notifyWebhookUrl must be an http(s) URL' };
  return { url };
}

// ------------------------------------------------------------ aggregates

async function aggregateFor(monitor) {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'PASS')::int AS passed,
            count(*) FILTER (WHERE status = 'FAIL')::int AS failed,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
       FROM monitor_results WHERE monitor_id = $1`,
    [monitor.id]
  );
  const row = rows[0] || { total: 0, passed: 0, failed: 0, p95: null };
  const total = Number(row.total) || 0;
  const passed = Number(row.passed) || 0;
  const failed = Number(row.failed) || 0;
  return {
    totalChecks: total,
    passed,
    failed,
    uptimePct: total ? Math.round((passed / total) * 10000) / 100 : null,
    p95DurationMs: row.p95 == null ? null : Math.round(Number(row.p95)),
    currentStreak: {
      status: monitor.status,
      count: monitor.status === 'DOWN' ? monitor.consecutive_failures : monitor.consecutive_successes,
    },
  };
}

// ------------------------------------------------------------------ List
router.get('/', async (req, res, next) => {
  try {
    const { projectId } = req.query;
    if (projectId !== undefined && projectId !== '') {
      if (!isUuid(projectId)) return res.status(400).json({ error: 'projectId must be a valid uuid' });
      if (!(await canReadProject(req.user.id, projectId))) {
        return res.status(403).json({ error: 'No access to this project' });
      }
    }
    const { rows } = projectId
      ? await query(`SELECT * FROM monitors WHERE project_id = $1 ORDER BY created_at DESC`, [projectId])
      : await query(`SELECT * FROM monitors ORDER BY created_at DESC`);
    const monitors = [];
    for (const row of rows) {
      if (projectId || (await canReadProject(req.user.id, row.project_id))) {
        monitors.push(toApi(row));
      }
    }
    res.json({ monitors });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Create
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const { projectId, name } = b;
    if (!isUuid(projectId)) return res.status(400).json({ error: 'projectId must be a valid uuid' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (!(await canWriteProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const target = await resolveTarget({
      targetType: b.targetType,
      requestId: b.requestId,
      workflowId: b.workflowId,
      projectId,
    });
    if (target.error) return res.status(400).json({ error: target.error });

    const scheduleCron = String(b.scheduleCron || '').trim();
    if (!isValidCron(scheduleCron)) {
      return res.status(400).json({ error: 'scheduleCron must be a valid 5-field cron expression' });
    }
    const threshold = b.failureThreshold === undefined ? 1 : Number(b.failureThreshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > MAX_THRESHOLD) {
      return res.status(400).json({ error: `failureThreshold must be an integer between 1 and ${MAX_THRESHOLD}` });
    }
    const webhook = normaliseWebhookUrl(b.notifyWebhookUrl);
    if (webhook.error) return res.status(400).json({ error: webhook.error });

    const { rows } = await query(
      `INSERT INTO monitors
         (project_id, name, target_type, request_id, workflow_id, schedule_cron,
          failure_threshold, notify_webhook_url, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        projectId,
        String(name).trim(),
        b.targetType,
        target.requestId,
        target.workflowId,
        scheduleCron,
        threshold,
        webhook.url,
        b.enabled !== false,
        req.user.id,
      ]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'monitor',
      entityId: rows[0].id,
      action: 'create_monitor',
      detail: { projectId, targetType: b.targetType, scheduleCron },
      ip: req.ip,
    });
    res.status(201).json({ monitor: toApi(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- Results
router.get('/:monitorId/results', async (req, res, next) => {
  try {
    const monitor = await loadMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    if (!(await canReadProject(req.user.id, monitor.project_id))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [results, aggregate] = await Promise.all([
      query(
        `SELECT id, status, http_status, duration_ms, error, checked_at
           FROM monitor_results WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT $2`,
        [monitor.id, limit]
      ),
      aggregateFor(monitor),
    ]);
    res.json({
      monitor: toApi(monitor),
      results: results.rows.map((r) => ({
        id: r.id,
        status: r.status,
        httpStatus: r.http_status,
        durationMs: r.duration_ms,
        error: r.error,
        checkedAt: r.checked_at,
      })),
      aggregate,
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------- Check now
// Runs the monitor immediately (records a result and may fire alerts).
router.post('/:monitorId/check', async (req, res, next) => {
  try {
    const monitor = await loadMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    if (!(await canWriteProject(req.user.id, monitor.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const outcome = await runMonitorById({ monitorId: monitor.id });
    if (!outcome) return res.status(404).json({ error: 'Monitor not found' });
    await logAudit({
      actorId: req.user.id,
      entityType: 'monitor',
      entityId: monitor.id,
      action: 'check_monitor',
      detail: { projectId: monitor.project_id, passed: outcome.check.passed },
      ip: req.ip,
    });
    const fresh = await loadMonitor(monitor.id);
    res.json({
      monitor: toApi(fresh),
      check: {
        passed: outcome.check.passed,
        httpStatus: outcome.check.httpStatus,
        durationMs: outcome.check.durationMs,
        error: outcome.check.error,
      },
      alerts: outcome.alerts,
      aggregate: await aggregateFor(fresh),
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Read
router.get('/:monitorId', async (req, res, next) => {
  try {
    const monitor = await loadMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    if (!(await canReadProject(req.user.id, monitor.project_id))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    res.json({ monitor: toApi(monitor), aggregate: await aggregateFor(monitor) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Update
router.patch('/:monitorId', async (req, res, next) => {
  try {
    const monitor = await loadMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    if (!(await canWriteProject(req.user.id, monitor.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const b = req.body || {};
    const sets = [];
    const params = [];
    const push = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return res.status(400).json({ error: 'name must not be empty' });
      push('name', name);
    }
    if (b.targetType !== undefined || b.requestId !== undefined || b.workflowId !== undefined) {
      const target = await resolveTarget({
        targetType: b.targetType,
        requestId: b.requestId,
        workflowId: b.workflowId,
        projectId: monitor.project_id,
        existing: monitor,
      });
      if (target.error) return res.status(400).json({ error: target.error });
      push('target_type', b.targetType || monitor.target_type);
      push('request_id', target.requestId);
      push('workflow_id', target.workflowId);
    }
    if (b.scheduleCron !== undefined) {
      const cron = String(b.scheduleCron || '').trim();
      if (!isValidCron(cron)) {
        return res.status(400).json({ error: 'scheduleCron must be a valid 5-field cron expression' });
      }
      push('schedule_cron', cron);
    }
    if (b.failureThreshold !== undefined) {
      const threshold = Number(b.failureThreshold);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > MAX_THRESHOLD) {
        return res.status(400).json({ error: `failureThreshold must be an integer between 1 and ${MAX_THRESHOLD}` });
      }
      push('failure_threshold', threshold);
    }
    if (b.notifyWebhookUrl !== undefined) {
      const webhook = normaliseWebhookUrl(b.notifyWebhookUrl);
      if (webhook.error) return res.status(400).json({ error: webhook.error });
      push('notify_webhook_url', webhook.url);
    }
    if (b.enabled !== undefined) {
      push('enabled', b.enabled === true);
    }

    if (sets.length) {
      params.push(monitor.id);
      await query(
        `UPDATE monitors SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
        params
      );
    }
    const fresh = await loadMonitor(monitor.id);
    await logAudit({
      actorId: req.user.id,
      entityType: 'monitor',
      entityId: monitor.id,
      action: 'update_monitor',
      detail: { projectId: monitor.project_id, changes: Object.keys(b) },
      ip: req.ip,
    });
    res.json({ monitor: toApi(fresh), aggregate: await aggregateFor(fresh) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Delete
router.delete('/:monitorId', async (req, res, next) => {
  try {
    const monitor = await loadMonitor(req.params.monitorId);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    if (!(await canWriteProject(req.user.id, monitor.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await query(`DELETE FROM monitors WHERE id = $1`, [monitor.id]);
    await logAudit({
      actorId: req.user.id,
      entityType: 'monitor',
      entityId: monitor.id,
      action: 'delete_monitor',
      detail: { projectId: monitor.project_id },
      ip: req.ip,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
