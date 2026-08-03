'use strict';

const { FormulaRunner } = require('../src/sandbox/formulaRunner');
const { RequestDispatcher } = require('../src/engine/requestDispatcher');
const { sanitizeRequest, RequestValidationError } = require('../src/engine/sanitizer');
const { NodeHttpExecutor } = require('../src/engine/httpExecutor');

const sandbox = new FormulaRunner({ poolSize: 1, memoryLimit: 64, timeoutMs: 100 });

class StubRepo {
  async findById() {
    return null;
  }
}

class StubStore {
  async resolve() {
    return {};
  }

  async setMany() {}
}

class StubRuns {
  async create(data) {
    return data;
  }
}

describe('sanitizer', () => {
  test('rejects header values containing CRLF (response-splitting)', () => {
    const req = {
      method: 'GET',
      url: 'https://api.example.com/x',
      headers: { 'x-trace': 'ok\r\nSet-Cookie: evil=1' },
      query: {},
      body: null,
    };
    expect(() => sanitizeRequest(req)).toThrow(RequestValidationError);
  });

  test('rejects unsafe header names (prototype keys)', () => {
    const headers = { ['__proto__']: { inject: 'x' } };
    const req = {
      method: 'GET',
      url: 'https://api.example.com/x',
      headers,
      query: {},
      body: null,
    };
    expect(() => sanitizeRequest(req)).toThrow(RequestValidationError);
  });

  test('rejects non-http(s) protocols', () => {
    for (const url of ['file:///etc/passwd', 'ftp://host/x', 'gopher://host/x', 'data:text/html,x']) {
      expect(() => sanitizeRequest({ method: 'GET', url, headers: {}, query: {}, body: null })).toThrow(
        RequestValidationError
      );
    }
  });

  test('rejects unsupported methods', () => {
    expect(() =>
      sanitizeRequest({ method: 'TRACE', url: 'https://api.example.com/x', headers: {}, query: {}, body: null })
    ).toThrow(RequestValidationError);
  });

  test('strips prototype-pollution keys from body/query', () => {
    const req = {
      method: 'POST',
      url: 'https://api.example.com/x',
      headers: { 'content-type': 'application/json' },
      query: { clean: '1' },
      body: { order_id: 7, __proto__: { pollute: true }, constructor: { x: 1 } },
    };
    sanitizeRequest(req);
    expect(req.body).toEqual({ order_id: 7 });
    expect(req.query).toEqual({ clean: '1' });
    expect({}.pollute).toBeUndefined();
  });
});

describe('NodeHttpExecutor', () => {
  test('sends JSON body and returns normalized response', async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe('https://api.example.com/orders');
      expect(init.method).toBe('POST');
      expect(init.headers['content-type']).toBe('application/json');
      expect(init.body).toBe('{"order_id":5}');
      return {
        status: 201,
        statusText: 'Created',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"ok":true}',
      };
    };
    const executor = new NodeHttpExecutor({ fetchImpl });
    const res = await executor.execute(
      { method: 'POST', url: 'https://api.example.com/orders', headers: {}, query: {}, body: { order_id: 5 } },
      { timeoutMs: 1000 }
    );
    expect(res.status).toBe(201);
    expect(res.body).toBe('{"ok":true}');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('RequestDispatcher edge cases', () => {
  test('throws when request row is missing', async () => {
    const dispatcher = new RequestDispatcher({
      sandbox,
      variableStore: new StubStore(),
      requestRepository: new StubRepo(),
      runRepository: new StubRuns(),
      httpExecutor: { execute: async () => ({ status: 200 }) },
    });
    await expect(dispatcher.execute({ requestId: 'nope', environmentId: 'env' })).rejects.toThrow(
      'Request not found'
    );
  });

  test('a poisoned formula cannot inject a CRLF header into the dispatched request', async () => {
    const row = {
      id: 'req-poison',
      method: 'GET',
      url: 'https://api.example.com/orders',
      headers: [],
      queryParams: [],
      bodyType: 'NONE',
      bodyJson: null,
      formula: 'req.headers["x-injected"] = "bad\\r\\nSet-Cookie: evil=1";',
    };
    const sent = [];
    const dispatcher = new RequestDispatcher({
      sandbox,
      variableStore: new StubStore(),
      requestRepository: { findById: async () => row },
      runRepository: new StubRuns(),
      httpExecutor: {
        execute: async (req) => {
          sent.push(req);
          return { status: 200 };
        },
      },
    });
    await expect(dispatcher.execute({ requestId: 'req-poison', environmentId: 'env' })).rejects.toBeInstanceOf(
      RequestValidationError
    );
    expect(sent).toHaveLength(0);
  });
});
