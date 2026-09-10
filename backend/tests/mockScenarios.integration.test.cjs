'use strict';

// E3 — Mock server scenarios & call logs integration test.
//
// server.js is frozen (other agents own it), so the test boots the real app
// for auth / mock-server / route CRUD and mounts THIS feature the way the
// coordinator will wire it:
//
//   const mockScenarios = require('./routes/mockScenarios');
//   app.use('/api', mockScenarios);
//   app.use('/mock/:projectId', mockScenarios.createMockScenarioMiddleware());
//   app.use('/mock/:projectId', mockDispatch);
//
// The feature app shares the same Postgres pool (Node module cache) and the
// same session cookie, so auth + project access gate exactly as in production.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const matcher = require('../src/api/mockMatcher');

const ROOT = path.resolve(__dirname, '..', '..');
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: process.env.INTEGRATION_PGDATABASE || 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync(
    'psql',
    ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-c', sql],
    { env: PGENV, stdio: 'pipe', encoding: 'utf8' }
  );
}

function psqlFile(file) {
  return execFileSync(
    'psql',
    ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-f', file],
    { env: PGENV, stdio: 'pipe', encoding: 'utf8' }
  );
}

let mainServer;
let featureServer;
let appBase;
let featureBase;
let projectId;
let mockServerId;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Client whose session cookie is shared across the main and feature apps.
function makeClient(defaultBase) {
  let cookie = '';
  async function api(method, url, body, baseOverride) {
    const target = baseOverride || defaultBase;
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${target}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /ah\.session=([^;]+)/.exec(setCookie);
      if (m) cookie = `ah.session=${m[1]}`;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  return { api, get cookie() { return cookie; } };
}

let admin;

function api(method, url, body) {
  return admin.api(method, url, body, featureBase);
}

async function signup(client, email, password, name) {
  const res = await client.api('POST', '/api/auth/signup', { email, password, name });
  assert.equal(res.status, 201, `${email} signup`);
}

async function defaultProjectId(client) {
  const ws = await client.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  assert.ok(myWs, 'found My Workspace');
  const content = await client.api('GET', `/api/workspaces/${myWs.id}/content`);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  assert.ok(project, 'found Default Project');
  return project.id;
}

async function createRoute(method, routePath, body) {
  const res = await admin.api('POST', `/api/mock-servers/${mockServerId}/routes`, {
    method,
    path: routePath,
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 201, `create route ${method} ${routePath}`);
  return res.json.route.id;
}

// Hit the public mock dispatcher on the feature app.
async function call(method, subpath, { headers, body } = {}) {
  const requestHeaders = { ...(headers || {}) };
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!requestHeaders['Content-Type']) requestHeaders['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${featureBase}/mock/${projectId}${subpath}`, {
    method,
    headers: requestHeaders,
    body: payload,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs
    .readdirSync(path.join(ROOT, 'db', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const express = require('express');
  const { createApp } = require('../src/api/server');
  const mockScenarios = require('../src/api/routes/mockScenarios');
  const { mockDispatch } = require('../src/api/mockDispatch');

  mainServer = await listen(createApp());
  appBase = `http://127.0.0.1:${mainServer.address().port}`;

  const featureApp = express();
  featureApp.use(express.json({ limit: '25mb' }));
  featureApp.use('/api', mockScenarios);
  featureApp.use('/mock/:projectId', mockScenarios.createMockScenarioMiddleware());
  featureApp.use('/mock/:projectId', mockDispatch);
  featureApp.use('/api', (req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });
  featureApp.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });
  featureServer = await listen(featureApp);
  featureBase = `http://127.0.0.1:${featureServer.address().port}`;

  // Replay re-issues over HTTP against the mock dispatcher in this same process.
  process.env.MOCK_REPLAY_BASE_URL = featureBase;

  admin = makeClient(appBase);
  await signup(admin, 'mockscenariosadmin@test.io', 'adminpass123', 'Scenario Admin');
  projectId = await defaultProjectId(admin);

  const created = await admin.api('POST', `/api/projects/${projectId}/mock-server`, { name: 'Scenario Mock' });
  assert.equal(created.status, 201);
  mockServerId = created.json.mockServer.id;
});

after(async () => {
  if (mainServer) await new Promise((r) => mainServer.close(r));
  if (featureServer) await new Promise((r) => featureServer.close(r));
  await require('../src/api/db').pool.end();
});

// ============================================================ pure matcher

test('mockMatcher condition DSL matches across header/query/body', () => {
  const ctx = matcher.requestContext(
    {
      headers: { 'x-api-version': '2', 'x-flag': 'yes' },
      query: { type: 'cat', page: '3' },
      body: { user: { role: 'admin' }, tags: ['a', 'b'] },
    },
    {}
  );
  assert.equal(matcher.conditionsMatch([{ source: 'query', name: 'type', operator: 'equals', value: 'cat' }], ctx), true);
  assert.equal(matcher.conditionsMatch([{ source: 'header', name: 'X-Api-Version', operator: 'equals', value: '2' }], ctx), true);
  assert.equal(matcher.conditionsMatch([{ source: 'body', name: 'user.role', operator: 'equals', value: 'admin' }], ctx), true);
  assert.equal(matcher.conditionsMatch([{ source: 'query', name: 'page', operator: 'regex', value: '^\\d+$' }], ctx), true);
  assert.equal(matcher.conditionsMatch([{ source: 'query', name: 'type', operator: 'in', value: ['dog', 'cat'] }], ctx), true);
  assert.equal(matcher.conditionsMatch([{ source: 'header', name: 'x-missing', operator: 'exists' }], ctx), false);
  assert.equal(matcher.conditionsMatch([{ source: 'query', name: 'type', operator: 'contains', value: 'ca' }], ctx), true);
  assert.equal(matcher.conditionsMatch([{ source: 'body', name: 'user.role', operator: 'notEquals', value: 'viewer' }], ctx), true);
  assert.equal(matcher.conditionsMatch([], ctx), true);
  assert.equal(matcher.conditionsMatch([{ source: 'query', name: 'type', operator: 'equals', value: 'dog' }], ctx), false);
});

test('mockMatcher sequence index wraps (cycle) or clamps (advance)', () => {
  assert.equal(matcher.sequenceIndexFor(1, 3, 'cycle'), 0);
  assert.equal(matcher.sequenceIndexFor(3, 3, 'cycle'), 2);
  assert.equal(matcher.sequenceIndexFor(4, 3, 'cycle'), 0);
  assert.equal(matcher.sequenceIndexFor(1, 2, 'advance'), 0);
  assert.equal(matcher.sequenceIndexFor(5, 2, 'advance'), 1);
});

test('mockMatcher scenarioFromRequest reads header then query', () => {
  assert.equal(matcher.scenarioFromRequest({ headers: { 'x-mock-scenario': 'down' }, query: {} }), 'down');
  assert.equal(matcher.scenarioFromRequest({ headers: {}, query: { __scenario: 'slow' } }), 'slow');
  assert.equal(matcher.scenarioFromRequest({ headers: {}, query: { scenario: 'slow' } }), 'slow');
  assert.equal(matcher.scenarioFromRequest({ headers: {}, query: {} }), null);
});

// ==================================================== conditional responses

test('conditional responses select by query / header matcher and fall back to static', async () => {
  const routeId = await createRoute('GET', '/pets', { source: 'base' });

  const cat = await api('POST', `/api/mock-routes/${routeId}/responses`, {
    name: 'cats',
    conditions: [{ source: 'query', name: 'type', operator: 'equals', value: 'cat' }],
    status: 200,
    body: JSON.stringify({ source: 'cat' }),
  });
  assert.equal(cat.status, 201, JSON.stringify(cat.json));
  assert.equal(cat.json.response.conditions[0].name, 'type');

  const versioned = await api('POST', `/api/mock-routes/${routeId}/responses`, {
    priority: 5,
    conditions: [{ source: 'header', name: 'X-Api-Version', operator: 'equals', value: '2' }],
    body: JSON.stringify({ source: 'v2' }),
  });
  assert.equal(versioned.status, 201);

  let res = await call('GET', '/pets?type=cat');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { source: 'cat' });

  res = await call('GET', '/pets', { headers: { 'X-Api-Version': '2' } });
  assert.deepEqual(res.json, { source: 'v2' });

  // Unknown value / no header -> base mock_routes response.
  res = await call('GET', '/pets?type=dog');
  assert.deepEqual(res.json, { source: 'base' });
  res = await call('GET', '/pets');
  assert.deepEqual(res.json, { source: 'base' });
});

test('JSON-body matcher selects a response for a POST route', async () => {
  const routeId = await createRoute('POST', '/orders', { source: 'base' });
  const created = await api('POST', `/api/mock-routes/${routeId}/responses`, {
    conditions: [{ source: 'body', name: 'amount', operator: 'equals', value: 100 }],
    body: JSON.stringify({ discount: true }),
  });
  assert.equal(created.status, 201);

  let res = await call('POST', '/orders', { body: { amount: 100 } });
  assert.deepEqual(res.json, { discount: true });

  res = await call('POST', '/orders', { body: { amount: 5 } });
  assert.deepEqual(res.json, { source: 'base' });
});

test('response validation rejects bad matchers, status and unknown scenario', async () => {
  const routeId = await createRoute('GET', '/validate', {});
  const badSource = await api('POST', `/api/mock-routes/${routeId}/responses`, {
    conditions: [{ source: 'cookie', name: 'x', operator: 'equals', value: 'y' }],
  });
  assert.equal(badSource.status, 400);

  const badOperator = await api('POST', `/api/mock-routes/${routeId}/responses`, {
    conditions: [{ source: 'query', name: 'x', operator: 'wat' }],
  });
  assert.equal(badOperator.status, 400);

  const badStatus = await api('POST', `/api/mock-routes/${routeId}/responses`, { status: 42 });
  assert.equal(badStatus.status, 400);

  const badScenario = await api('POST', `/api/mock-routes/${routeId}/responses`, {
    scenarioId: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(badScenario.status, 400);
});

// ============================================================ named scenarios

test('a named scenario overrides defaults for header and query activation', async () => {
  const routeId = await createRoute('GET', '/status', { state: 'ok' });

  const scenario = await api('POST', '/api/mock-scenarios', { mockServerId, name: 'maintenance' });
  assert.equal(scenario.status, 201, JSON.stringify(scenario.json));
  const scenarioId = scenario.json.scenario.id;

  const override = await api('POST', `/api/mock-routes/${routeId}/responses`, {
    scenarioId,
    status: 503,
    body: JSON.stringify({ state: 'down' }),
  });
  assert.equal(override.status, 201);

  let res = await call('GET', '/status');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { state: 'ok' });

  res = await call('GET', '/status', { headers: { 'X-Mock-Scenario': 'maintenance' } });
  assert.equal(res.status, 503);
  assert.deepEqual(res.json, { state: 'down' });

  res = await call('GET', '/status?__scenario=maintenance');
  assert.equal(res.status, 503);

  // Unknown scenario names are ignored (default set served).
  res = await call('GET', '/status?__scenario=nope');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { state: 'ok' });

  // Listing exposes the scenario.
  const list = await api('GET', `/api/mock-scenarios?mockServerId=${mockServerId}`);
  assert.equal(list.status, 200);
  assert.ok(list.json.scenarios.some((s) => s.name === 'maintenance'));

  // Duplicate name is a conflict.
  const dup = await api('POST', '/api/mock-scenarios', { mockServerId, name: 'maintenance' });
  assert.equal(dup.status, 409);

  // Deleting the scenario removes its override.
  const del = await api('DELETE', `/api/mock-scenarios/${scenarioId}`);
  assert.equal(del.status, 200);
  res = await call('GET', '/status', { headers: { 'X-Mock-Scenario': 'maintenance' } });
  assert.equal(res.status, 200);
});

// ========================================================= stateful sequences

test('a sequence cycles through ordered responses and can be reset', async () => {
  const routeId = await createRoute('GET', '/seq', { step: 'base' });
  for (const [index, step] of ['a', 'b', 'c'].entries()) {
    const res = await api('POST', `/api/mock-routes/${routeId}/responses`, {
      sequenceIndex: index,
      body: JSON.stringify({ step }),
    });
    assert.equal(res.status, 201);
  }
  const stateBefore = await api('GET', `/api/mock-routes/${routeId}/responses`);
  assert.equal(stateBefore.json.responses.filter((r) => r.sequence_index !== null).length, 3);

  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    seen.push((await call('GET', '/seq')).json.step);
  }
  assert.deepEqual(seen, ['a', 'b', 'c', 'a']);

  const reset = await api('POST', `/api/mock-routes/${routeId}/sequence/reset`, {});
  assert.equal(reset.status, 200);
  assert.equal((await call('GET', '/seq')).json.step, 'a');
});

test('advance-mode sequences clamp on the last response', async () => {
  const routeId = await createRoute('GET', '/adv', { step: 'base' });
  for (const [index, step] of ['x', 'y'].entries()) {
    await api('POST', `/api/mock-routes/${routeId}/responses`, {
      sequenceIndex: index,
      sequenceMode: 'advance',
      body: JSON.stringify({ step }),
    });
  }
  const seen = [];
  for (let i = 0; i < 3; i += 1) seen.push((await call('GET', '/adv')).json.step);
  assert.deepEqual(seen, ['x', 'y', 'y']);
});

// ================================================================ call logs

test('call logs capture matched route/scenario/status and replay re-issues', async () => {
  const logs = await api('GET', `/api/mock-call-logs?mockServerId=${mockServerId}&limit=200`);
  assert.equal(logs.status, 200);
  assert.ok(logs.json.total > 0);

  const catCall = logs.json.logs.find(
    (l) => l.path === '/pets' && l.query && l.query.type === 'cat'
  );
  assert.ok(catCall, 'logged the /pets?type=cat request');
  assert.equal(catCall.method, 'GET');
  assert.equal(catCall.status, 200);
  assert.equal(catCall.source, 'scenario');
  assert.equal(catCall.matched_route_path, '/pets');

  const replay = await api('POST', `/api/mock-call-logs/${catCall.id}/replay`);
  assert.equal(replay.status, 200, JSON.stringify(replay.json));
  assert.equal(replay.json.replay.status, 200);
  assert.deepEqual(JSON.parse(replay.json.replay.body), { source: 'cat' });
  assert.ok(replay.json.log, 'replay produced a new log row');
  assert.equal(replay.json.log.replayed_from, catCall.id);
});

test('an unmatched mock request is logged with source unmatched', async () => {
  const res = await call('GET', '/nope-not-here');
  assert.equal(res.status, 404);
  const logs = await api('GET', `/api/mock-call-logs?mockServerId=${mockServerId}&limit=200`);
  const row = logs.json.logs.find((l) => l.path === '/nope-not-here');
  assert.ok(row, 'unmatched request logged');
  assert.equal(row.source, 'unmatched');
  assert.equal(row.status, 404);
});

test('clearing the call log empties it', async () => {
  const cleared = await api('DELETE', `/api/mock-call-logs?mockServerId=${mockServerId}`);
  assert.equal(cleared.status, 200);
  const logs = await api('GET', `/api/mock-call-logs?mockServerId=${mockServerId}`);
  assert.equal(logs.json.total, 0);
});

// ============================================================ access control

test('scenarios and call logs are project-scoped', async () => {
  const dev = makeClient(appBase);
  await signup(dev, 'mockscenariosdev@test.io', 'devpass123', 'Scenario Dev');

  const scenarios = await dev.api('GET', `/api/mock-scenarios?mockServerId=${mockServerId}`, undefined, featureBase);
  assert.equal(scenarios.status, 403);

  const logs = await dev.api('GET', `/api/mock-call-logs?mockServerId=${mockServerId}`, undefined, featureBase);
  assert.equal(logs.status, 403);

  const create = await dev.api('POST', '/api/mock-scenarios', { mockServerId, name: 'x' }, featureBase);
  assert.equal(create.status, 403);
});
