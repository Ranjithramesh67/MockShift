'use strict';

const { Router } = require('express');
const { query } = require('../db');
const {
  requireAuth,
  canReadProject,
  canWriteProject,
} = require('../access');
const { runWorkflow } = require('../workflowService');
const { logAudit } = require('../audit');
const { redactSnapshot } = require('../redact');

const router = Router();
router.use(requireAuth);

// ------------------------------------------------------------- Workflows
router.post('/workflows', async (req, res, next) => {
  try {
    const { projectId, name, definition } = req.body || {};
    if (!projectId || !name) return res.status(400).json({ error: 'projectId and name are required' });
    if (!(await canWriteProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const steps = definition?.steps;
    if (!Array.isArray(steps)) return res.status(400).json({ error: 'definition.steps must be an array' });

    const { rows } = await query(
      `INSERT INTO workflow_chains (project_id, name, definition)
       VALUES ($1, $2, $3)
       RETURNING id, project_id, name, definition`,
      [projectId, String(name).trim(), JSON.stringify({ steps })],
      { userId: req.user.id }
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'workflow',
      entityId: rows[0].id,
      action: 'create_workflow',
      detail: { projectId, name },
      ip: req.ip,
    });
    res.status(201).json({ workflow: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/workflows', async (req, res, next) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId query param required' });
    if (!(await canReadProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const { rows } = await query(
      `SELECT id, project_id, name, definition, created_at, updated_at
         FROM workflow_chains WHERE project_id = $1 ORDER BY name`,
      [projectId],
      { userId: req.user.id }
    );
    res.json({ workflows: rows });
  } catch (err) {
    next(err);
  }
});

async function workflowWithAccess(req, res) {
  const { rows } = await query(
    `SELECT wc.id, wc.project_id, wc.name, wc.definition, wc.created_at, wc.updated_at
       FROM workflow_chains wc WHERE wc.id = $1`,
    [req.params.workflowId]
  );
  const wf = rows[0];
  if (!wf) return { error: 'Workflow not found' };
  return { wf };
}

router.get('/workflows/:workflowId', async (req, res, next) => {
  try {
    const { wf, error } = await workflowWithAccess(req, res);
    if (error) return res.status(404).json({ error });
    if (!(await canReadProject(req.user.id, wf.project_id))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    res.json({ workflow: wf });
  } catch (err) {
    next(err);
  }
});

router.put('/workflows/:workflowId', async (req, res, next) => {
  try {
    const { wf, error } = await workflowWithAccess(req, res);
    if (error) return res.status(404).json({ error });
    if (!(await canWriteProject(req.user.id, wf.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : wf.name;
    const steps = b.definition?.steps;
    const definition = steps ? JSON.stringify({ steps }) : JSON.stringify(wf.definition);
    const { rows } = await query(
      `UPDATE workflow_chains SET name = $1, definition = $2, updated_at = now()
        WHERE id = $3 RETURNING id, project_id, name, definition`,
      [name, definition, req.params.workflowId],
      { userId: req.user.id }
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'workflow',
      entityId: req.params.workflowId,
      action: 'update_workflow',
      detail: { projectId: wf.project_id },
      ip: req.ip,
    });
    res.json({ workflow: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/workflows/:workflowId', async (req, res, next) => {
  try {
    const { wf, error } = await workflowWithAccess(req, res);
    if (error) return res.status(404).json({ error });
    if (!(await canWriteProject(req.user.id, wf.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await query(`DELETE FROM workflow_chains WHERE id = $1`, [req.params.workflowId], {
      userId: req.user.id,
    });
    await logAudit({
      actorId: req.user.id,
      entityType: 'workflow',
      entityId: req.params.workflowId,
      action: 'delete_workflow',
      detail: { projectId: wf.project_id },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/workflows/:workflowId/run', async (req, res, next) => {
  try {
    const { wf, error } = await workflowWithAccess(req, res);
    if (error) return res.status(404).json({ error });
    if (!(await canReadProject(req.user.id, wf.project_id))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const runId = await runWorkflow({ workflowId: wf.id, trigger: 'MANUAL', userId: req.user.id });
    await logAudit({
      actorId: req.user.id,
      entityType: 'workflow',
      entityId: wf.id,
      action: 'run_workflow',
      detail: { projectId: wf.project_id },
      ip: req.ip,
    });
    res.json({ runId, status: 'PENDING' });
  } catch (err) {
    next(err);
  }
});

router.get('/workflows/:workflowId/runs', async (req, res, next) => {
  try {
    const { wf, error } = await workflowWithAccess(req, res);
    if (error) return res.status(404).json({ error });
    if (!(await canReadProject(req.user.id, wf.project_id))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await query(
      `SELECT id, trigger, status, started_at, finished_at, request_snapshot, response_snapshot
         FROM run_history WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [wf.id, limit],
      { userId: req.user.id }
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

module.exports = router;
