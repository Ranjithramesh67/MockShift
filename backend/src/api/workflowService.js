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

// On completion, sync the owning automations and notify owners on failure.
async function reflectInAutomations(runId, status) {
  try {
    const { rows } = await query(
      `SELECT a.id, a.created_by, a.name, a.notify_on_failure,
              wc.name AS workflow_name
         FROM automations a
         JOIN workflow_chains wc ON wc.id = a.workflow_id
        WHERE a.workflow_id = (SELECT workflow_id FROM run_history WHERE id = $1)`,
      [runId]
    );
    for (const a of rows) {
      await query(
        `UPDATE automations SET last_run_at = now(), last_status = $1, updated_at = now()
          WHERE id = $2`,
        [status, a.id]
      );
      if (status === 'FAILED' && a.notify_on_failure && a.created_by) {
        await query(
          `INSERT INTO notifications (user_id, title, body, kind)
           VALUES ($1, $2, $3, 'error')`,
          [
            a.created_by,
            `Automation "${a.name}" failed`,
            `Workflow "${a.workflow_name}" did not complete successfully. Run: ${runId}`,
          ]
        );
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
  getEngine,
  getScheduler,
};
