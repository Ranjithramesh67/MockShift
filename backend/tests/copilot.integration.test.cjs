'use strict';

// Integration tests for the AI copilot (E4 / P4):
//   GET  /api/copilot/status
//   POST /api/copilot/generate-assertions
//   POST /api/copilot/explain-run
//   POST /api/copilot/generate-docs
//
// The model is ALWAYS stubbed via llm.setCallModel — no network and no real API
// key is used. When USER_LLM_* is unconfigured the routes must return 503 and
// never touch the injected model.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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

function psqlScalar(sql) {
  return execFileSync('psql', ['-t', '-A', '-c', sql], { env: PGENV, stdio: 'pipe', encoding: 'utf8' }).trim();
}

const SECRET = 'super-secret-value-123';
const MARKER = '\u00abredacted\u00bb';

let server;
let base;
let llm;
let captured;

function makeClient() {
  let cookie = '';
  async function api(method, url, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${url}`, {
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
  return { api };
}

let admin;
let userId;
let requestId;

const RESPONSE_SNAPSHOT = {
  status: 500,
  headers: { 'content-type': 'application/json', 'set-cookie': `session=${SECRET}` },
  body: JSON.stringify({ error: 'boom', token: SECRET, data: { id: 123 } }),
  durationMs: 42,
};

function setConfigured(on) {
  if (on) {
    process.env.USER_LLM_API_KEY = 'test-user-key';
    process.env.USER_LLM_BASE_URL = 'http://127.0.0.1:9/v1';
    process.env.USER_LLM_MODEL = 'test-model';
  } else {
    delete process.env.USER_LLM_API_KEY;
    delete process.env.USER_LLM_BASE_URL;
    delete process.env.USER_LLM_MODEL;
  }
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  setConfigured(false);
  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  // server.js is a coordinator seam and does not mount /api/copilot yet, so this
  // test assembles the minimal set of routers it needs (auth + content) and
  // mounts the copilot router directly. Production wiring is a one-line
  // app.use('/api/copilot', require('./routes/copilot')) in server.js.
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/auth', require('../src/api/routes/auth'));
  app.use('/api/workspaces', require('../src/api/routes/workspaces'));
  app.use('/api', require('../src/api/routes/content'));
  app.use('/api/copilot', require('../src/api/routes/copilot'));

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'copilotadmin@test.io',
    password: 'adminpass123',
    name: 'Copilot Admin',
  });
  assert.equal(signup.status, 201);
  userId = signup.json.user.id;

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  const projectId = content.json.projects.find((p) => p.name === 'Default Project').id;

  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Copilot Col' });
  assert.equal(col.status, 201);
  const collectionId = col.json.collection.id;

  const created = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'List pets',
    method: 'GET',
    url: 'https://example.test/pets',
  });
  assert.equal(created.status, 201);
  requestId = created.json.request.id;

  const patched = await admin.api('PUT', `/api/requests/${requestId}`, {
    headers: [
      { key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true },
      { key: 'X-Trace', value: 'abc', enabled: true },
    ],
    queryParams: [{ key: 'api_key', value: SECRET, enabled: true }],
    bodyJson: { username: 'alice', password: SECRET },
  });
  assert.equal(patched.status, 200);

  llm = require('../src/api/llm');
  captured = [];
  llm.setCallModel(async (input) => {
    captured.push(input);
    const system = String(input.system || '');
    if (system.includes('documentation')) {
      return {
        text: JSON.stringify({
          blocks: [
            { type: 'heading', content: { text: 'List pets' } },
            { type: 'text', content: { text: 'Returns every pet.' } },
            { type: 'code', content: { language: 'bash', code: 'curl /pets' } },
            { type: 'list', content: { style: 'bullet', items: ['Paginated'] } },
          ],
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'test-model',
        provider: 'openai-compatible',
      };
    }
    if (system.includes('debugging')) {
      return {
        text: JSON.stringify({ explanation: 'Upstream returned HTTP 500 before the DB was reached.' }),
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        model: 'test-model',
        provider: 'openai-compatible',
      };
    }
    return {
      text: JSON.stringify({
        assertions: [
          { type: 'status', operator: 'eq', expected: '200' },
          { type: 'jsonPath', operator: 'contains', path: 'data.id', expected: '123' },
          { type: 'header', operator: 'contains', path: 'content-type', expected: 'json' },
          { type: 'bogus', operator: 'eq', expected: 'x' },
        ],
      }),
      usage: { promptTokens: 20, completionTokens: 9, totalTokens: 29 },
      model: 'test-model',
      provider: 'openai-compatible',
    };
  });
});

after(async () => {
  if (llm) llm.resetCallModel();
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

test('unconfigured env returns 503 on every capability and makes no model call', async () => {
  setConfigured(false);
  captured.length = 0;

  const status = await admin.api('GET', '/api/copilot/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.configured, false);

  const a = await admin.api('POST', '/api/copilot/generate-assertions', { requestId, response: RESPONSE_SNAPSHOT });
  assert.equal(a.status, 503);
  assert.equal(a.json.code, 'LLM_NOT_CONFIGURED');

  const e = await admin.api('POST', '/api/copilot/explain-run', { runId: '00000000-0000-0000-0000-000000000000' });
  assert.equal(e.status, 503);

  const d = await admin.api('POST', '/api/copilot/generate-docs', { requestId });
  assert.equal(d.status, 503);

  assert.equal(captured.length, 0, 'no model call when unconfigured');
});

test('generate-assertions redacts inputs, normalizes assertions and audits usage', async () => {
  setConfigured(true);
  captured.length = 0;
  const before = Number(psqlScalar('SELECT count(*) FROM ai_copilot_usage'));

  const res = await admin.api('POST', '/api/copilot/generate-assertions', {
    requestId,
    response: RESPONSE_SNAPSHOT,
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.assertions.length, 3, 'invalid assertion type is dropped');
  const status = res.json.assertions.find((x) => x.type === 'status');
  assert.equal(status.operator, 'eq');
  assert.equal(status.expected, '200');
  const jp = res.json.assertions.find((x) => x.type === 'jsonPath');
  assert.equal(jp.path, 'data.id');

  // Redaction ran before the prompt was built.
  assert.equal(captured.length, 1, 'model called once');
  const prompt = captured[0].prompt;
  assert.ok(!prompt.includes(SECRET), 'secret must not reach the model');
  assert.ok(prompt.includes(MARKER), 'redaction marker present');

  // Usage row written.
  const after = Number(psqlScalar('SELECT count(*) FROM ai_copilot_usage'));
  assert.equal(after, before + 1);

  // The response body never contains the key.
  assert.ok(!JSON.stringify(res.json).includes('test-user-key'));
});

test('explain-run returns a plain-language explanation for an owned run', async () => {
  setConfigured(true);
  captured.length = 0;

  const run = await require('../src/api/db').query(
    `INSERT INTO run_history (request_id, user_id, trigger, status, request_snapshot, response_snapshot)
     VALUES ($1, $2, 'MANUAL', 'FAILED', $3, $4) RETURNING id`,
    [
      requestId,
      userId,
      JSON.stringify({ method: 'GET', url: `https://example.test/pets?api_key=${SECRET}`, headers: { Authorization: `Bearer ${SECRET}` } }),
      JSON.stringify(RESPONSE_SNAPSHOT),
    ]
  );
  const runId = run.rows[0].id;

  const res = await admin.api('POST', '/api/copilot/explain-run', { runId });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.ok(res.json.explanation.includes('500'), 'explanation returned');
  assert.equal(captured.length, 1);
  assert.ok(!captured[0].prompt.includes(SECRET), 'run snapshot redacted before prompt');
  assert.ok(!JSON.stringify(res.json).includes(SECRET));
});

test('generate-docs returns valid doc blocks in the existing shape', async () => {
  setConfigured(true);

  const res = await admin.api('POST', '/api/copilot/generate-docs', { requestId });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const types = res.json.blocks.map((b) => b.type);
  assert.deepEqual(types, ['heading', 'text', 'code', 'list']);
  for (const b of res.json.blocks) {
    assert.equal(b.id, null);
    assert.ok(b.content && typeof b.content === 'object');
  }
  assert.equal(res.json.blocks.find((b) => b.type === 'code').content.language, 'bash');
});

test('generate-assertions can fall back to the latest stored run snapshot', async () => {
  setConfigured(true);
  const res = await admin.api('POST', '/api/copilot/generate-assertions', { requestId });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.ok(Array.isArray(res.json.assertions));
});
