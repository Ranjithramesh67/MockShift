'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, canWriteProject, canReadProject } = require('../access');
const {
  runWorkflow,
  registerAutomation,
  unregisterAutomation,
  newWebhookToken,
} = require('../workflowService');
const { logAudit } = require('../audit');
const { redactSnapshot } = require('../redact');

const router = Router();
router.use(requireAuth);

async function automationWithAccess(automationId) {
  const { rows } = await query(
    `SELECT a.*, wc.name AS workflow_name, p.name AS project_name
       FROM automations a
       JOIN workflow_chains wc ON wc.id = a.workflow_id
       JOIN projects p ON p.id = a.project_id
      WHERE a.id = $1`,
    [automationId]
  );
  return rows[0] || null;
}

function webhookUrl(token) {
  return `/api/webhooks/${token}`;
}

function toApi(automation) {
  return {
    id: automation.id,
    name: automation.name,
    projectId: automation.project_id,
    workflowId: automation.workflow_id,
    triggerType: automation.trigger_type,
    scheduleCron: automation.schedule_cron,
    webhookToken: automation.webhook_token,
    eventRequestId: automation.event_request_id,
    sourceWorkflowId: automation.source_workflow_id,
    notifyWebhookUrl: automation.notify_webhook_url,
    inputVars: automation.input_vars,
    notifyOnFailure: automation.notify_on_failure,
    enabled: automation.enabled,
    createdBy: automation.created_by,
    createdAt: automation.created_at,
    updatedAt: automation.updated_at,
    lastRunAt: automation.last_run_at,
    lastStatus: automation.last_status,
    workflowName: automation.workflow_name,
    projectName: automation.project_name,
    webhookUrl: automation.trigger_type === 'WEBHOOK' ? webhookUrl(automation.webhook_token) : null,
  };
}

const TRIGGER_TYPES = ['SCHEDULE', 'WEBHOOK', 'ON_REQUEST', 'ON_RUN_FAILURE'];

async function requestInProject(requestId, projectId) {
  if (!requestId) return true;
  const { rows } = await query(
    `SELECT 1 FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
      WHERE ar.id = $1 AND c.project_id = $2`,
    [requestId, projectId]
  );
  return rows.length > 0;
}

async function workflowInProject(workflowId, projectId) {
  if (!workflowId) return true;
  const { rows } = await query(
    `SELECT 1 FROM workflow_chains WHERE id = $1 AND project_id = $2`,
    [workflowId, projectId]
  );
  return rows.length > 0;
}

// ------------------------------------------------------------------ List
router.get('/automations', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, wc.name AS workflow_name, p.name AS project_name
         FROM automations a
         JOIN workflow_chains wc ON wc.id = a.workflow_id
         JOIN projects p ON p.id = a.project_id
        ORDER BY a.created_at DESC`
    );
    const scoped = [];
    for (const a of rows) {
      if (await canWriteProject(req.user.id, a.project_id)) scoped.push(toApi(a));
    }
    res.json({ automations: scoped });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- Create
router.post('/automations', async (req, res, next) => {
  try {
    const b = req.body || {};
    const { name, projectId, workflowId, triggerType } = b;
    if (!name || !projectId || !workflowId) {
      return res.status(400).json({ error: 'name, projectId and workflowId are required' });
    }
    if (!TRIGGER_TYPES.includes(triggerType)) {
      return res.status(400).json({
        error: 'triggerType must be SCHEDULE, WEBHOOK, ON_REQUEST or ON_RUN_FAILURE',
      });
    }
    if (!(await canWriteProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const wf = await query(
      `SELECT id FROM workflow_chains WHERE id = $1 AND project_id = $2`,
      [workflowId, projectId]
    );
    if (wf.rows.length === 0) return res.status(404).json({ error: 'Workflow not found in this project' });

    if (!(await requestInProject(b.eventRequestId, projectId))) {
      return res.status(400).json({ error: 'Watched request is not in this project' });
    }
    if (!(await workflowInProject(b.sourceWorkflowId, projectId))) {
      return res.status(400).json({ error: 'Watched workflow is not in this project' });
    }
    const notifyWebhookUrl = String(b.notifyWebhookUrl || '').trim() || null;
    if (notifyWebhookUrl && !/^https?:\/\//i.test(notifyWebhookUrl)) {
      return res.status(400).json({ error: 'notifyWebhookUrl must be an http(s) URL' });
    }

    const scheduleCron = triggerType === 'SCHEDULE' ? b.scheduleCron : null;
    if (triggerType === 'SCHEDULE' && !scheduleCron) {
      return res.status(400).json({ error: 'scheduleCron is required for SCHEDULE automations' });
    }
    const webhookToken = triggerType === 'WEBHOOK' ? newWebhookToken() : null;

    const { rows } = await query(
      `INSERT INTO automations
         (name, project_id, workflow_id, trigger_type, schedule_cron, webhook_token,
          event_request_id, source_workflow_id, notify_webhook_url,
          input_vars, notify_on_failure, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        String(name).trim(),
        projectId,
        workflowId,
        triggerType,
        scheduleCron,
        webhookToken,
        b.eventRequestId || null,
        b.sourceWorkflowId || null,
        notifyWebhookUrl,
        b.inputVars ? JSON.stringify(b.inputVars) : JSON.stringify({}),
        b.notifyOnFailure !== false,
        b.enabled !== false,
        req.user.id,
      ]
    );
    const automation = rows[0];
    await registerAutomation(automation);
    await logAudit({
      actorId: req.user.id,
      entityType: 'automation',
      entityId: automation.id,
      action: 'create_automation',
      detail: { projectId, workflowId, triggerType },
      ip: req.ip,
    });
    res.status(201).json({ automation: toApi(automation) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Read
router.get('/automations/:automationId', async (req, res, next) => {
  try {
    const automation = await automationWithAccess(req.params.automationId);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    if (!(await canReadProject(req.user.id, automation.project_id))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    res.json({ automation: toApi(automation) });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- Update
router.patch('/automations/:automationId', async (req, res, next) => {
  try {
    const automation = await automationWithAccess(req.params.automationId);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    if (!(await canWriteProject(req.user.id, automation.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const b = req.body || {};
    const sets = [];
    const params = [];
    if (b.name !== undefined) {
      params.push(String(b.name).trim());
      sets.push(`name = $${params.length}`);
    }
    if (b.scheduleCron !== undefined) {
      params.push(b.scheduleCron || null);
      sets.push(`schedule_cron = $${params.length}`);
    }
    if (b.notifyOnFailure !== undefined) {
      params.push(b.notifyOnFailure === true);
      sets.push(`notify_on_failure = $${params.length}`);
    }
    if (b.inputVars !== undefined) {
      params.push(JSON.stringify(b.inputVars));
      sets.push(`input_vars = $${params.length}`);
    }
    if (b.enabled !== undefined) {
      params.push(b.enabled === true);
      sets.push(`enabled = $${params.length}`);
    }
    if (b.eventRequestId !== undefined) {
      if (!(await requestInProject(b.eventRequestId, automation.project_id))) {
        return res.status(400).json({ error: 'Watched request is not in this project' });
      }
      params.push(b.eventRequestId || null);
      sets.push(`event_request_id = $${params.length}`);
    }
    if (b.sourceWorkflowId !== undefined) {
      if (!(await workflowInProject(b.sourceWorkflowId, automation.project_id))) {
        return res.status(400).json({ error: 'Watched workflow is not in this project' });
      }
      params.push(b.sourceWorkflowId || null);
      sets.push(`source_workflow_id = $${params.length}`);
    }
    if (b.notifyWebhookUrl !== undefined) {
      const url = String(b.notifyWebhookUrl || '').trim() || null;
      if (url && !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'notifyWebhookUrl must be an http(s) URL' });
      }
      params.push(url);
      sets.push(`notify_webhook_url = $${params.length}`);
    }
    if (sets.length) {
      params.push(automation.id);
      await query(
        `UPDATE automations SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
        params
      );
    }
    const fresh = await automationWithAccess(automation.id);
    await unregisterAutomation(automation.id);
    await registerAutomation(fresh);
    await logAudit({
      actorId: req.user.id,
      entityType: 'automation',
      entityId: automation.id,
      action: 'update_automation',
      detail: { projectId: automation.project_id, changes: Object.keys(b) },
      ip: req.ip,
    });
    res.json({ automation: toApi(fresh) });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- Delete
router.delete('/automations/:automationId', async (req, res, next) => {
  try {
    const automation = await automationWithAccess(req.params.automationId);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    if (!(await canWriteProject(req.user.id, automation.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await unregisterAutomation(automation.id);
    await query(`DELETE FROM automations WHERE id = $1`, [automation.id]);
    await logAudit({
      actorId: req.user.id,
      entityType: 'automation',
      entityId: automation.id,
      action: 'delete_automation',
      detail: { projectId: automation.project_id },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Runs
router.get('/automations/:automationId/runs', async (req, res, next) => {
  try {
    const automation = await automationWithAccess(req.params.automationId);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    if (!(await canReadProject(req.user.id, automation.project_id))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await query(
      `SELECT id, trigger, status, started_at, finished_at, request_snapshot, response_snapshot
         FROM run_history WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [automation.workflow_id, limit]
    );
    res.json({
      runs: rows.map((r) => ({
        ...r,
        request_snapshot: r.request_snapshot ? redactSnapshot(r.request_snapshot, {}) : null,
        response_snapshot: r.response_snapshot ? redactSnapshot(r.response_snapshot, {}) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- Trigger now
router.post('/automations/:automationId/trigger', async (req, res, next) => {
  try {
    const automation = await automationWithAccess(req.params.automationId);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    if (!(await canWriteProject(req.user.id, automation.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const runId = await runWorkflow({
      workflowId: automation.workflow_id,
      trigger: automation.trigger_type === 'WEBHOOK' ? 'WEBHOOK' : 'CRON',
      inputVars: automation.input_vars || {},
    });
    await logAudit({
      actorId: req.user.id,
      entityType: 'automation',
      entityId: automation.id,
      action: 'trigger_automation',
      detail: { projectId: automation.project_id, runId },
      ip: req.ip,
    });
    res.json({ runId, status: 'PENDING' });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, automationWithAccess, toApi, webhookUrl };
