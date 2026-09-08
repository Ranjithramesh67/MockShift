'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { getProjectAccess } = require('../access');
const { loadRequest, executePipeline, resolveVariables } = require('../runner');
const { authenticateApiToken, readBearerToken } = require('../tokenAuth');
const { verifySession, readSessionToken } = require('../authLib');
const { loadUserById } = require('../access');
const { fireWorkflowEvent } = require('../workflowService');
const { chargeRuns, orgOfProject } = require('../entitlements');
const { redactSnapshot } = require('../redact');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RUN_SCOPES = ['runs', 'write'];

function badUuid(value) {
  return typeof value !== 'string' || !UUID_RE.test(value.trim());
}

async function authenticate(req) {
  if (readBearerToken(req)) {
    const auth = await authenticateApiToken(req);
    return { user: auth.user, kind: 'token', apiToken: auth.token };
  }
  const payload = verifySession(readSessionToken(req));
  if (!payload) return null;
  const user = await loadUserById(payload.userId);
  if (!user || !user.is_active) return null;
  return { user, kind: 'session', apiToken: null };
}

async function projectOfRequest(requestId) {
  const { rows } = await query(
    `SELECT p.id AS project_id, p.workspace_id
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
       JOIN projects p ON p.id = c.project_id
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

async function environmentMatchesRequest(environmentId, requestId) {
  const { rows } = await query(
    `SELECT 1
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
       JOIN projects p ON p.id = c.project_id
       JOIN environments e ON e.workspace_id = p.workspace_id
      WHERE ar.id = $1 AND e.id = $2`,
    [requestId, environmentId]
  );
  return rows.length > 0;
}

// Mirrors content.js fireRequestRunEvents: fire ON_REQUEST / ON_RUN_FAILURE
// event-driven automations after a stored-request run. Best-effort, never
// throws. (Duplicated here because content.js does not export its copy.)
async function fireRequestRunEvents(requestId, projectId, result) {
  if (!projectId || !result) return;
  try {
    const context = {
      runId: result.runId,
      httpStatus: result.httpStatus,
      method: result.requestSnapshot && result.requestSnapshot.method,
      url: result.requestSnapshot && result.requestSnapshot.url,
    };
    await fireWorkflowEvent({
      type: 'ON_REQUEST',
      projectId,
      requestId,
      runId: result.runId,
      status: result.runStatus,
      context,
    });
    if (result.runStatus === 'FAILED') {
      await fireWorkflowEvent({
        type: 'ON_RUN_FAILURE',
        projectId,
        requestId,
        runId: result.runId,
        status: result.runStatus,
        context,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[serverRuns] fireRequestRunEvents failed:', err.message);
  }
}

// POST /api/runs — run a stored request server-side.
// Auth: session cookie OR API token Bearer (scopes: runs | write).
// Body:  { requestId, environmentId?, variables? }
// The UI's ephemeral POST /api/runs (in-memory scratchpad body, no requestId,
// no Authorization header) falls through via next() to the content router.
router.post('/runs', async (req, res, next) => {
  try {
    const body = req.body || {};
    const hasBearer = Boolean(readBearerToken(req));

    if (body.requestId === undefined || body.requestId === null) {
      if (!hasBearer) return next();
      return res.status(400).json({ error: 'requestId is required' });
    }
    if (badUuid(body.requestId)) {
      return res.status(400).json({ error: 'requestId must be a valid uuid' });
    }

    let actor;
    try {
      actor = await authenticate(req);
    } catch (err) {
      return res.status(err.status || 401).json({ error: err.message || 'Invalid API token' });
    }
    if (!actor) {
      return res.status(401).json({ error: 'Not authenticated — session cookie or API token required' });
    }

    if (actor.kind === 'token' && !actor.apiToken.scopes.some((s) => TOKEN_RUN_SCOPES.includes(s))) {
      return res.status(403).json({ error: 'API token requires the "runs" or "write" scope to run requests' });
    }

    const requestId = body.requestId.trim();
    const request = await loadRequest(requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const proj = await projectOfRequest(requestId);
    const access = proj ? await getProjectAccess(actor.user.id, proj.project_id) : null;
    if (!proj || !access) {
      return res.status(403).json({ error: 'No access to this request' });
    }

    let environmentId = null;
    if (body.environmentId !== undefined && body.environmentId !== null && body.environmentId !== '') {
      if (badUuid(body.environmentId)) {
        return res.status(400).json({ error: 'environmentId must be a valid uuid' });
      }
      environmentId = body.environmentId.trim();
      if (!(await environmentMatchesRequest(environmentId, requestId))) {
        return res.status(400).json({ error: 'environmentId does not belong to this request\'s workspace' });
      }
    }

    let variables = {};
    if (body.variables !== undefined && body.variables !== null) {
      if (typeof body.variables !== 'object' || Array.isArray(body.variables)) {
        return res.status(400).json({ error: 'variables must be an object of string values' });
      }
      variables = {};
      for (const [k, v] of Object.entries(body.variables)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          variables[k] = String(v);
        }
      }
    }

    const runCharge = await chargeRuns({
      userId: actor.user.id,
      orgId: proj ? await orgOfProject(proj.project_id) : null,
    });
    if (!runCharge.ok) return res.status(403).json(runCharge.body);

    const resolved = environmentId
      ? await query(`SELECT key, value FROM app.resolve_variables($1, $2)`, [requestId, environmentId], {
          userId: actor.user.id,
        })
      : null;
    let baseVars;
    if (resolved) {
      baseVars = {};
      for (const r of resolved.rows) baseVars[r.key] = r.value;
    } else {
      baseVars = await resolveVariables({ requestId }, actor.user.id);
    }
    const vars = Object.keys(variables).length ? { ...baseVars, ...variables } : baseVars;

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const result = await executePipeline({ request, vars, userId: actor.user.id, persistHistory: false });
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedMs;

    const { rows: runRows } = await query(
      `INSERT INTO run_history
         (request_id, user_id, trigger, status, request_snapshot, response_snapshot, started_at, finished_at)
       VALUES ($1, $2, 'api', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        requestId,
        actor.user.id,
        result.runStatus,
        JSON.stringify(result.requestSnapshot || {}),
        result.response ? JSON.stringify(result.response) : null,
        startedAt,
        finishedAt,
      ],
      { userId: actor.user.id }
    );
    const runId = runRows[0].id;

    for (const t of result.testResults || []) {
      await query(
        `INSERT INTO test_results (run_id, test_name, passed, assertions, error)
         VALUES ($1, $2, $3, $4, $5)`,
        [runId, t.message, t.passed, JSON.stringify(t), t.passed ? null : t.message]
      );
    }
    result.runId = runId;
    await fireRequestRunEvents(requestId, proj.project_id, result);

    res.json({
      run: {
        id: runId,
        requestId,
        name: request.name,
        trigger: 'api',
        status: result.runStatus,
        statusCode: result.httpStatus,
        durationMs,
        startedAt,
        finishedAt,
        error: result.error || null,
        requestSnapshot: result.requestSnapshot ? redactSnapshot(result.requestSnapshot, {}) : null,
        responseSnapshot: result.response ? redactSnapshot(result.response, {}) : null,
        testResults: result.testResults || [],
        assertionsPassed: result.assertionsPassed !== undefined ? result.assertionsPassed : false,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
