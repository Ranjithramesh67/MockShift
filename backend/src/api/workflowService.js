'use strict';

// ---------------------------------------------------------------------------
// WorkflowService
//
// Bridges the standalone (tested) WorkflowEngine/WorkflowScheduler to the API
// database so stored workflows can be run manually, on a cron schedule or via
// webhook. All repositories are DB-backed adapters around the existing
// runner/query helpers. The engine is created lazily so tests and processes
// that never run workflows don't pay the BullMQ/Redis cost.
// ---------------------------------------------------------------------------

const { randomUUID } = require('crypto');
const { Redis } = require('ioredis');
const { WorkflowEngine } = require('../workflow/workflowEngine');
const { WorkflowScheduler } = require('../workflow/workflowScheduler');
const { FormulaRunner } = require('../sandbox/formulaRunner');
const { NodeHttpExecutor } = require('../engine/httpExecutor');
const { RequestDispatcher } = require('../engine/requestDispatcher');
const { query } = require('./db');
const { loadRequest } = require('./runner');

// ------------------------------------------------------------- Repositories
const workflowRepository = {
  async findById(workflowId) {
    const { rows } = await query(
      `SELECT id, project_id, name, definition FROM workflow_chains WHERE id = $1`,
      [workflowId]
    );
    const wf = rows[0];
    if (!wf) return null;
    return {
      id: wf.id,
      projectId: wf.project_id,
      name: wf.name,
      steps: Array.isArray(wf.definition?.steps) ? wf.definition.steps : [],
    };
  },
};

const runStore = {
  async create({ id, workflowId, trigger, status, startedAt, userId = null }) {
    await query(
      `INSERT INTO run_history (id, workflow_id, trigger, status, started_at, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, workflowId, trigger, status, startedAt || new Date().toISOString(), userId]
    );
    return { id, workflowId, status };
  },

  async update(runId, { status, finishedAt, steps, vars }) {
    await query(
      `UPDATE run_history
          SET status = $1, finished_at = $2,
              request_snapshot = $3, response_snapshot = $4
        WHERE id = $5`,
      [
        status,
        finishedAt || new Date().toISOString(),
        steps ? JSON.stringify(steps) : null,
        vars ? JSON.stringify(vars) : null,
        runId,
      ]
    );
    await reflectInAutomations(runId, status);
  },
};

const requestRepository = {
  async findById(requestId) {
    const row = await loadRequest(requestId);
    if (!row) return null;
    return {
      id: row.id,
      method: row.method,
      url: row.url,
      headers: row.headers || [],
      queryParams: row.query_params || [],
      bodyType: row.body_type,
      bodyJson: row.body_json,
      bodyText: row.body_text,
      apiType: row.api_type,
      formula: row.formula || '',
    };
  },
};

const variableStore = {
  async resolve({ requestId, environmentId }) {
    const { rows } = await query(
      `SELECT key, value FROM app.resolve_variables($1, $2)`,
      [requestId, environmentId || null]
    );
    const vars = {};
    for (const r of rows) vars[r.key] = r.value;
    return vars;
  },
  // Workflows run with persistVars: false — nothing to write back.
  async setMany() {
    return undefined;
  },
};

const runRepository = {
  async create({
    requestId,
    environmentId,
    actorId,
    trigger,
    status,
    requestSnapshot,
    responseSnapshot,
    startedAt,
    finishedAt,
    vars,
  }) {
    void environmentId;
    void actorId;
    await query(
      `INSERT INTO run_history
         (request_id, trigger, status, request_snapshot, response_snapshot, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        requestId,
        trigger,
        status,
        requestSnapshot ? JSON.stringify(requestSnapshot) : null,
        responseSnapshot ? JSON.stringify(responseSnapshot) : null,
        startedAt ? startedAt.toISOString() : new Date().toISOString(),
        finishedAt ? finishedAt.toISOString() : new Date().toISOString(),
      ]
    );
    return { requestId, status, requestSnapshot, responseSnapshot, vars };
  },
};

// Deliver a richer, external failure notification to a user-configured webhook.
async function postWebhookNotification(url, payload) {
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // Best-effort delivery; never break the run itself.
    // eslint-disable-next-line no-console
    console.error('[workflow] notify webhook delivery failed:', err.message);
  }
}

// Fire an event-driven automation (ON_REQUEST / ON_RUN_FAILURE): find every
// enabled automation in the project matching the event and kick off its
// workflow with the event context injected into the input variables.
async function fireWorkflowEvent({
  type,
  projectId,
  requestId = null,
  sourceWorkflowId = null,
  runId = null,
  status = null,
  context = {},
}) {
  try {
    const { rows } = await query(
      `SELECT id, workflow_id, input_vars
         FROM automations
        WHERE project_id = $1 AND trigger_type = $2 AND enabled = true
          AND (event_request_id IS NULL OR event_request_id = $3)
          AND (source_workflow_id IS NULL OR source_workflow_id = $4)`,
      [projectId, type, requestId || null, sourceWorkflowId || null]
    );
    for (const a of rows) {
      const inputVars = {
        ...(a.input_vars || {}),
        event: {
          type,
          projectId,
          requestId: requestId || null,
          sourceWorkflowId: sourceWorkflowId || null,
          runId: runId || null,
          status: status || null,
          ...context,
        },
      };
      runWorkflow({ workflowId: a.workflow_id, trigger: type, inputVars }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[workflow] event ${type} -> workflow ${a.workflow_id} failed:`, err.message);
      });
    }
    return rows.length;
  } catch (err) {
    // Best-effort event handling; never break the triggering run.
    // eslint-disable-next-line no-console
    console.error('[workflow] fireWorkflowEvent failed:', err.message);
    return 0;
  }
}

// On completion, sync the owning automations and notify owners on failure.
async function reflectInAutomations(runId, status) {
  try {
    const runRows = await query(
      `SELECT rh.trigger, rh.workflow_id,
              COALESCE(wc.project_id, c.project_id) AS project_id
         FROM run_history rh
         LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
         LEFT JOIN api_requests ar ON ar.id = rh.request_id
         LEFT JOIN collections c ON c.id = ar.collection_id
        WHERE rh.id = $1`,
      [runId]
    );
    const run = runRows.rows[0];
    if (!run) return;

    // ON_RUN_FAILURE event workflows. Loop guard: never re-fire for runs that
    // were themselves started by an ON_RUN_FAILURE event.
    if (status === 'FAILED' && run.trigger !== 'ON_RUN_FAILURE' && run.project_id) {
      await fireWorkflowEvent({
        type: 'ON_RUN_FAILURE',
        projectId: run.project_id,
        sourceWorkflowId: run.workflow_id || null,
        runId,
        status,
      });
    }

    const { rows } = await query(
      `SELECT a.id, a.created_by, a.name, a.notify_on_failure, a.notify_webhook_url,
              wc.name AS workflow_name
         FROM automations a
         JOIN workflow_chains wc ON wc.id = a.workflow_id
        WHERE a.workflow_id = $1`,
      [run.workflow_id]
    );
    for (const a of rows) {
      await query(
        `UPDATE automations SET last_run_at = now(), last_status = $1, updated_at = now()
          WHERE id = $2`,
        [status, a.id]
      );
      if (status === 'FAILED') {
        if (a.notify_on_failure && a.created_by) {
          await query(
            `INSERT INTO notifications (user_id, title, body, kind, payload, link)
             VALUES ($1, $2, $3, 'error', $4, $5)`,
            [
              a.created_by,
              `Automation "${a.name}" failed`,
              `Workflow "${a.workflow_name}" did not complete successfully. Run: ${runId}`,
              JSON.stringify({
                runId,
                projectId: run.project_id,
                workflowId: run.workflow_id,
                status,
              }),
              '/automations',
            ]
          );
        }
        if (a.notify_webhook_url) {
          await postWebhookNotification(a.notify_webhook_url, {
            event: 'run_failed',
            runId,
            automation: { id: a.id, name: a.name },
            workflow: a.workflow_name,
            projectId: run.project_id,
            status,
            at: new Date().toISOString(),
          });
        }
      }
    }
  } catch (err) {
    // Best-effort bookkeeping; never break the run itself.
    // eslint-disable-next-line no-console
    console.error('[workflow] reflectInAutomations failed:', err.message);
  }
}

// ------------------------------------------------------------------- Engine
let engine = null;
let scheduler = null;
let engineConnection = null;
let schedulerConnection = null;

function redisConfig() {
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    db: Number(process.env.REDIS_DB || 0),
    maxRetriesPerRequest: null,
  };
}

function getEngine() {
  if (engine) return engine;
  engineConnection = new Redis(redisConfig());
  const sandbox = new FormulaRunner({ poolSize: 2, memoryLimit: 64, timeoutMs: 500 });
  const dispatcher = new RequestDispatcher({
    sandbox,
    variableStore,
    requestRepository,
    runRepository,
    httpExecutor: new NodeHttpExecutor({ timeoutMs: 20000 }),
  });
  engine = new WorkflowEngine({
    name: 'api',
    dispatcher,
    sandbox,
    workflowRepository,
    runStore,
    connection: engineConnection,
  });
  return engine;
}

function getScheduler() {
  if (scheduler) return scheduler;
  schedulerConnection = new Redis(redisConfig());
  scheduler = new WorkflowScheduler({
    name: 'api',
    engine: getEngine(),
    connection: schedulerConnection,
  });
  return scheduler;
}

async function runWorkflow({ workflowId, trigger = 'MANUAL', inputVars = {}, userId = null }) {
  return getEngine().start({ workflowId, inputVars, trigger, userId });
}

// Close the engine/scheduler and their Redis connections (used by tests so the
// process can exit cleanly). Idempotent and safe when never created.
async function shutdownWorkflows() {
  const jobs = [];
  if (engine) {
    jobs.push(engine.close().catch(() => undefined));
    engine = null;
  }
  if (scheduler) {
    jobs.push(scheduler.close().catch(() => undefined));
    scheduler = null;
  }
  if (engineConnection) {
    jobs.push(engineConnection.quit().catch(() => undefined));
    engineConnection = null;
  }
  if (schedulerConnection) {
    jobs.push(schedulerConnection.quit().catch(() => undefined));
    schedulerConnection = null;
  }
  await Promise.all(jobs);
}

async function registerAutomation(automation) {
  if (automation.trigger_type !== 'SCHEDULE' || !automation.enabled || !automation.schedule_cron) {
    return null;
  }
  const id = `automation:${automation.id}`;
  await getScheduler().registerCron({
    workflowId: automation.workflow_id,
    cron: automation.schedule_cron,
    jobId: id,
    inputVars: automation.input_vars || {},
  });
  return id;
}

async function unregisterAutomation(automationId) {
  if (!scheduler) return;
  await getScheduler().removeCron({ jobId: `automation:${automationId}` });
}

async function syncAllSchedules() {
  try {
    const { rows } = await query(
      `SELECT id, workflow_id, trigger_type, schedule_cron, enabled, input_vars
         FROM automations WHERE trigger_type = 'SCHEDULE'`
    );
    for (const a of rows) {
      if (a.enabled && a.schedule_cron) {
        await getScheduler().registerCron({
          workflowId: a.workflow_id,
          cron: a.schedule_cron,
          jobId: `automation:${a.id}`,
          inputVars: a.input_vars || {},
        });
      }
    }
    return rows.length;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[workflow] syncAllSchedules failed:', err.message);
    return 0;
  }
}

function newWebhookToken() {
  return `wh_${randomUUID().replace(/-/g, '').slice(0, 32)}`;
}

module.exports = {
  runWorkflow,
  registerAutomation,
  unregisterAutomation,
  syncAllSchedules,
  newWebhookToken,
  fireWorkflowEvent,
  shutdownWorkflows,
  getEngine,
  getScheduler,
};
