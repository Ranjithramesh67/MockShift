'use strict';

const { FormulaRunner } = require('../src/sandbox/formulaRunner');
const { RequestDispatcher } = require('../src/engine/requestDispatcher');

class FakeVariableStore {
  constructor(initial) {
    this.vars = { ...initial };
    this.writes = [];
  }

  async resolve() {
    return { ...this.vars };
  }

  async setMany({ values }) {
    this.writes.push({ ...values });
    Object.assign(this.vars, values);
  }
}

class FakeRequestRepository {
  constructor(row) {
    this.row = row;
  }

  async findById() {
    return this.row;
  }
}

class FakeRunRepository {
  constructor() {
    this.runs = [];
  }

  async create(data) {
    const run = { id: `run-${this.runs.length + 1}`, ...data };
    this.runs.push(run);
    return run;
  }
}

class FakeHttpExecutor {
  constructor() {
    this.sent = [];
  }

  async execute(req) {
    this.sent.push(req);
    return {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      body: req.body ? JSON.stringify({ id: req.body.order_id }) : '{}',
      durationMs: 3,
    };
  }
}

const sandbox = new FormulaRunner({ poolSize: 2, memoryLimit: 64, timeoutMs: 100 });

const ORDER_REQUEST = {
  id: 'req-create-order',
  method: 'POST',
  url: 'https://api.example.com/orders',
  headers: [{ key: 'content-type', value: 'application/json' }],
  queryParams: [],
  bodyType: 'JSON',
  bodyJson: { order_id: 0 },
  formula:
    'req.body.order_id = $vars.orderId + 1;' +
    'req.headers["x-request-guid"] = $utils.uuid();' +
    '$vars.orderId = req.body.order_id;',
};

describe('RequestDispatcher — sequential order id increments', () => {
  test('payload order_id increments 1001 -> 1002 -> 1003 across 3 executions', async () => {
    const variableStore = new FakeVariableStore({ orderId: 1000 });
    const httpExecutor = new FakeHttpExecutor();
    const runRepository = new FakeRunRepository();
    const dispatcher = new RequestDispatcher({
      sandbox,
      variableStore,
      requestRepository: new FakeRequestRepository(ORDER_REQUEST),
      runRepository,
      httpExecutor,
    });

    for (let i = 0; i < 3; i += 1) {
      await dispatcher.execute({ requestId: 'req-create-order', environmentId: 'env-prod' });
    }

    expect(httpExecutor.sent).toHaveLength(3);
    expect(httpExecutor.sent.map((req) => req.body.order_id)).toEqual([1001, 1002, 1003]);
    expect(variableStore.vars.orderId).toBe(1003);
    expect(runRepository.runs).toHaveLength(3);
    expect(runRepository.runs.map((r) => r.status)).toEqual(['SUCCESS', 'SUCCESS', 'SUCCESS']);
  });

  test('persisted variable writes are recorded after each execution', async () => {
    const variableStore = new FakeVariableStore({ orderId: 2000 });
    const httpExecutor = new FakeHttpExecutor();
    const dispatcher = new RequestDispatcher({
      sandbox,
      variableStore,
      requestRepository: new FakeRequestRepository(ORDER_REQUEST),
      runRepository: new FakeRunRepository(),
      httpExecutor,
    });

    await dispatcher.execute({ requestId: 'req-create-order', environmentId: 'env-prod' });
    await dispatcher.execute({ requestId: 'req-create-order', environmentId: 'env-prod' });

    expect(variableStore.writes).toEqual([{ orderId: 2001 }, { orderId: 2002 }]);
  });

  test('{{var}} templates resolve from variables before dispatch', async () => {
    const row = {
      id: 'req-templated',
      method: 'GET',
      url: 'https://{{host}}/v{{version}}/orders/{{orderId}}',
      headers: [{ key: 'x-tenant', value: '{{tenant}}' }],
      queryParams: [{ key: 'source', value: '{{source}}' }],
      bodyType: 'NONE',
      bodyJson: null,
    };
    const variableStore = new FakeVariableStore({
      host: 'api.example.com',
      version: 2,
      orderId: 900,
      tenant: 'acme',
      source: 'regression',
    });
    const httpExecutor = new FakeHttpExecutor();
    const dispatcher = new RequestDispatcher({
      sandbox,
      variableStore,
      requestRepository: new FakeRequestRepository(row),
      runRepository: new FakeRunRepository(),
      httpExecutor,
    });

    await dispatcher.execute({ requestId: 'req-templated', environmentId: 'env-prod' });

    expect(httpExecutor.sent[0].url).toBe('https://api.example.com/v2/orders/900');
    expect(httpExecutor.sent[0].headers['x-tenant']).toBe('acme');
    expect(httpExecutor.sent[0].query.source).toBe('regression');
  });
});
