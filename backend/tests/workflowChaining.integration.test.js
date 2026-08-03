'use strict';

const { Redis } = require('ioredis');
const { FormulaRunner } = require('../src/sandbox/formulaRunner');
const { RequestDispatcher } = require('../src/engine/requestDispatcher');
const { WorkflowEngine } = require('../src/workflow/workflowEngine');
const { WorkflowScheduler } = require('../src/workflow/workflowScheduler');

jest.setTimeout(30000);

const CONNECTION = { host: '127.0.0.1', port: 6379, db: 15 };
const openResources = [];

const REQUEST_ROWS = {
  'req-order': {
    id: 'req-order',
    method: 'POST',
    url: 'https://api.example.com/orders',
    headers: [{ key: 'content-type', value: 'application/json' }],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: { order_id: 0 },
  },
  'req-delivery': {
    id: 'req-delivery',
    method: 'POST',
    url: 'https://api.example.com/deliveries/{{order.order_id}}',
    headers: [{ key: 'content-type', value: 'application/json' }],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: { ref: 0 },
    formula: 'req.body.ref = $vars.order.order_id;',
  },
  'req-invoice': {
    id: 'req-invoice',
    method: 'POST',
    url: 'https://api.example.com/invoices',
    headers: [{ key: 'content-type', value: 'application/json' }],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: { orderId: 0 },
  },
  'req-fail': {
    id: 'req-fail',
    method: 'GET',
    url: 'https://api.example.com/fail',
    headers: [],
    queryParams: [],
    bodyType: 'NONE',
    bodyJson: null,
  },
  'req-optional': {
    id: 'req-optional',
    method: 'GET',
    url: 'https://api.example.com/optional',
    headers: [],
    queryParams: [],
    bodyType: 'NONE',
    bodyJson: null,
  },
};

class InMemoryWorkflowRepository {
  constructor() {
    this.workflows = new Map();
  }

  add(workflow) {
    this.workflows.set(workflow.id, workflow);
  }

  async findById(id) {
    return this.workflows.get(id) || null;
  }
}

class InMemoryRunStore {
  constructor() {
    this.runs = new Map();
  }

  async create(run) {
    this.runs.set(run.id, run);
    return run;
  }

  async update(id, patch) {
    const next = { ...this.runs.get(id), ...patch };
    this.runs.set(id, next);
    return next;
  }

  async get(id) {
    return this.runs.get(id);
  }

  async all() {
    return [...this.runs.values()];
  }
}

class InMemoryRequestRepository {
  constructor(rows) {
    this.rows = rows;
  }

  async findById(id) {
    return this.rows[id] || null;
  }
}

class RecordingHttpExecutor {
  constructor() {
    this.calls = [];
    this.responses = {};
  }

  setResponse(requestId, resp) {
    this.responses[requestId] = resp;
  }

  async execute(req) {
    const start = Date.now();
    const resp = this.responses[req.requestId] || { status: 200, body: '{}' };
    const end = Date.now();
    this.calls.push({
      requestId: req.requestId,
      start,
      end,
      url: req.url,
      body: req.body,
      headers: req.headers,
      query: req.query,
    });
    return {
      status: resp.status,
      statusText: String(resp.status),
      headers: { 'content-type': 'application/json' },
      body: resp.body,
      durationMs: 1,
      start,
      end,
    };
  }

  callsFor(requestId) {
    return this.calls.filter((c) => c.requestId === requestId);
  }
}

function makeEngine({ name, http, workflows }) {
  const sandbox = new FormulaRunner({ poolSize: 2, memoryLimit: 64, timeoutMs: 100 });
  const dispatcher = new RequestDispatcher({
    sandbox,
    variableStore: { resolve: async () => ({}), setMany: async () => {} },
    requestRepository: new InMemoryRequestRepository(REQUEST_ROWS),
    runRepository: { create: async (data) => data },
    httpExecutor: http,
  });
  const workflowRepository = new InMemoryWorkflowRepository();
  for (const workflow of workflows) {
    workflowRepository.add(workflow);
  }
  const runStore = new InMemoryRunStore();
  const engine = new WorkflowEngine({
    name,
    dispatcher,
    sandbox,
    workflowRepository,
    runStore,
    connection: CONNECTION,
  });
  openResources.push(engine);
  return { engine, runStore, http };
}

async function waitForRun(runStore, runId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let run;
  while (Date.now() < deadline) {
    run = await runStore.get(runId);
    if (run && run.status !== 'PENDING') return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`run ${runId} did not finish in ${timeoutMs}ms; last=${JSON.stringify(run)}`);
}

async function waitForRuns(runStore, count, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = (await runStore.all()).filter((r) => r.status !== 'PENDING');
    if (runs.length >= count) return runs;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected ${count} finished runs in ${timeoutMs}ms`);
}

const redis = new Redis(CONNECTION);

beforeAll(async () => {
  await redis.flushdb();
});

afterEach(async () => {
  for (const resource of openResources.splice(0)) {
    try {
      await resource.close();
    } catch {
      // best-effort cleanup
    }
  }
  await redis.flushdb();
});

afterAll(async () => {
  for (const resource of openResources.splice(0)) {
    try {
      await resource.close();
    } catch {
      // best-effort cleanup
    }
  }
  await redis.quit();
});

describe('workflow chaining (BullMQ)', () => {
  test('passes step 1 response into step 2 as a variable and loops a step', async () => {
    const http = new RecordingHttpExecutor();
    http.setResponse('req-order', { status: 201, body: JSON.stringify({ order_id: 7 }) });
    http.setResponse('req-delivery', { status: 201, body: '{}' });
    const { engine, runStore } = makeEngine({
      name: 'chain',
      http,
      workflows: [
        {
          id: 'wf-chain',
          steps: [
            { id: 'order', requestId: 'req-order' },
            { id: 'delivery', requestId: 'req-delivery', loop: 3 },
          ],
        },
      ],
    });

    const runId = await engine.start({ workflowId: 'wf-chain' });
    const run = await waitForRun(runStore, runId);

    expect(run.status).toBe('SUCCESS');
    expect(run.vars.order).toEqual({ order_id: 7 });
    const deliveries = http.callsFor('req-delivery');
    expect(deliveries).toHaveLength(3);
    for (const delivery of deliveries) {
      expect(delivery.url).toBe('https://api.example.com/deliveries/7');
      expect(delivery.body.ref).toBe(7);
    }
    expect(http.callsFor('req-order')).toHaveLength(1);
  });

  test('step 2 starts ~5000ms after step 1 completes (delay)', async () => {
    const http = new RecordingHttpExecutor();
    http.setResponse('req-order', { status: 201, body: JSON.stringify({ order_id: 42 }) });
    http.setResponse('req-delivery', { status: 201, body: '{}' });
    const { engine, runStore } = makeEngine({
      name: 'delay',
      http,
      workflows: [
        {
          id: 'wf-delay',
          steps: [
            { id: 'order', requestId: 'req-order' },
            { id: 'delivery', requestId: 'req-delivery', delayMs: 5000 },
          ],
        },
      ],
    });

    const runId = await engine.start({ workflowId: 'wf-delay' });
    const run = await waitForRun(runStore, runId, 20000);

    expect(run.status).toBe('SUCCESS');
    const gap = http.callsFor('req-delivery')[0].start - http.callsFor('req-order')[0].end;
    expect(gap).toBeGreaterThanOrEqual(5000);
    expect(gap).toBeLessThanOrEqual(8000);
  });

  test('step 2 is skipped when step 1 fails (abort semantics)', async () => {
    const http = new RecordingHttpExecutor();
    http.setResponse('req-fail', { status: 500, body: 'server error' });
    http.setResponse('req-delivery', { status: 201, body: '{}' });
    const { engine, runStore } = makeEngine({
      name: 'abort',
      http,
      workflows: [
        {
          id: 'wf-fail',
          steps: [
            { id: 'order', requestId: 'req-fail' },
            { id: 'delivery', requestId: 'req-delivery' },
          ],
        },
      ],
    });

    const runId = await engine.start({ workflowId: 'wf-fail' });
    const run = await waitForRun(runStore, runId);

    expect(run.status).toBe('FAILED');
    expect(run.steps['order#0'].status).toBe('FAILED');
    expect(http.callsFor('req-delivery')).toHaveLength(0);
  });

  test('skips a step when its condition is falsy and continues to the next', async () => {
    const http = new RecordingHttpExecutor();
    http.setResponse('req-order', { status: 201, body: JSON.stringify({ order_id: 1 }) });
    http.setResponse('req-optional', { status: 200, body: '{}' });
    http.setResponse('req-invoice', { status: 201, body: '{}' });
    const { engine, runStore } = makeEngine({
      name: 'cond',
      http,
      workflows: [
        {
          id: 'wf-cond',
          steps: [
            { id: 'order', requestId: 'req-order' },
            {
              id: 'optional',
              requestId: 'req-optional',
              condition: '$steps.order.response.status === 500',
            },
            { id: 'invoice', requestId: 'req-invoice' },
          ],
        },
      ],
    });

    const runId = await engine.start({ workflowId: 'wf-cond' });
    const run = await waitForRun(runStore, runId);

    expect(run.status).toBe('SUCCESS');
    expect(run.steps['optional#0'].status).toBe('SKIPPED');
    expect(http.callsFor('req-optional')).toHaveLength(0);
    expect(http.callsFor('req-invoice')).toHaveLength(1);
  });

  test('registers and removes cron schedules', async () => {
    const http = new RecordingHttpExecutor();
    http.setResponse('req-order', { status: 201, body: '{}' });
    const { engine } = makeEngine({
      name: 'cron-reg',
      http,
      workflows: [{ id: 'wf-cron', steps: [{ id: 'order', requestId: 'req-order' }] }],
    });
    const scheduler = new WorkflowScheduler({ name: 'cron-reg', engine, connection: CONNECTION });
    openResources.push(scheduler);

    const jobId = await scheduler.registerCron({
      workflowId: 'wf-cron',
      cron: '*/5 * * * *',
      jobId: 'cron-reg-test',
    });
    const jobs = await scheduler.getCrons();
    expect(jobs.find((j) => j.key === jobId)).toBeDefined();

    const removed = await scheduler.removeCron({ jobId });
    expect(removed).toBe(true);
    const after = await scheduler.getCrons();
    expect(after.find((j) => j.key === jobId)).toBeUndefined();
  });

  test('schedules workflows to run automatically (interval trigger)', async () => {
    const http = new RecordingHttpExecutor();
    http.setResponse('req-order', { status: 201, body: '{}' });
    const { engine, runStore } = makeEngine({
      name: 'cron-auto',
      http,
      workflows: [{ id: 'wf-cron', steps: [{ id: 'order', requestId: 'req-order' }] }],
    });
    const scheduler = new WorkflowScheduler({ name: 'cron-auto', engine, connection: CONNECTION });
    openResources.push(scheduler);

    await scheduler.registerInterval({
      workflowId: 'wf-cron',
      everyMs: 400,
      jobId: 'cron-auto-test',
    });

    const runs = await waitForRuns(runStore, 1, 10000);
    expect(runs[0].trigger).toBe('CRON');
    expect(runs[0].status).toBe('SUCCESS');
    expect(http.callsFor('req-order').length).toBeGreaterThanOrEqual(1);

    await scheduler.removeCron({ jobId: 'cron-auto-test' });
  });
});
