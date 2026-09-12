'use strict';

// Integration tests for per-user BYO LLM config:
//   - admin toggle defaults off and blocks user writes
//   - when enabled, a user stores an encrypted config; GET never returns the key
//   - copilot prefers the user config over an unconfigured environment
//   - DELETE forgets the config
//
// The model is always stubbed via llm.setCallModel — no network is used.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

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

const RESPONSE_SNAPSHOT = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ data: { id: 123 } }),
  durationMs: 12,
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlScalar(sql) {
  return execFileSync('psql', ['-t', '-A', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
}

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

function clearEnvConfig() {
  delete process.env.USER_LLM_API_KEY;
  delete process.env.USER_LLM_BASE_URL;
  delete process.env.USER_LLM_MODEL;
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  clearEnvConfig();
  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/auth', require('../src/api/routes/auth'));
  app.use('/api/profile/llm', require('../src/api/routes/userLlm'));
  app.use('/api/admin', require('../src/api/routes/admin'));
  app.use('/api/workspaces', require('../src/api/routes/workspaces'));
  app.use('/api', require('../src/api/routes/content'));
  app.use('/api/copilot', require('../src/api/routes/copilot'));

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'llmadmin@test.io',
    password: 'adminpass123',
    name: 'LLM Admin',
  });
  assert.equal(signup.status, 201);
  userId = signup.json.user.user.id;

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  const projectId = content.json.projects.find((p) => p.name === 'Default Project').id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'LLM Col' });
  const created = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Ping',
    method: 'GET',
    url: 'https://example.test/ping',
  });
  requestId = created.json.request.id;

  llm = require('../src/api/llm');
  captured = [];
  llm.setCallModel(async (input) => {
    captured.push(input);
    return {
      text: JSON.stringify({ assertions: [{ type: 'status', operator: 'eq', expected: '200' }] }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: input.config ? input.config.model : 'stub',
      provider: 'openai-compatible',
    };
  });
});

after(async () => {
  llm.resetCallModel();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('toggle defaults off; GET reports not allowed; PUT is rejected', async () => {
  const toggle = await admin.api('GET', '/api/admin/settings/individual-llm');
  assert.equal(toggle.status, 200);
  assert.equal(toggle.json.allowed, false);

  const info = await admin.api('GET', '/api/profile/llm');
  assert.equal(info.status, 200);
  assert.equal(info.json.allowed, false);

  const put = await admin.api('PUT', '/api/profile/llm', {
    apiKey: 'sk-user',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
  });
  assert.equal(put.status, 403);
  assert.equal(put.json.code, 'individual_llm_disabled');
});

test('non-admin cannot flip the toggle', async () => {
  const other = makeClient();
  await other.api('POST', '/api/auth/signup', {
    email: 'llmeditor@test.io',
    password: 'editorpass123',
    name: 'LLM Editor',
  });
  const forbidden = await other.api('PUT', '/api/admin/settings/individual-llm', { allowed: true });
  assert.equal(forbidden.status, 403);
});

test('when enabled a user config is stored encrypted and never returned', async () => {
  const on = await admin.api('PUT', '/api/admin/settings/individual-llm', { allowed: true });
  assert.equal(on.status, 200);
  assert.equal(on.json.allowed, true);

  const put = await admin.api('PUT', '/api/profile/llm', {
    apiKey: 'sk-super-secret',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.configured, true);
  assert.equal(put.json.source, 'user');
  assert.equal(put.json.model, 'gpt-4o-mini');
  assert.equal('apiKey' in put.json, false);
  assert.equal(JSON.stringify(put.json).includes('sk-super-secret'), false);

  // Stored as ciphertext, not plaintext.
  const stored = psqlScalar(
    `SELECT encode(api_key_encrypted, 'escape') FROM user_llm_configs WHERE user_id = '${userId}'`
  );
  assert.equal(stored.includes('sk-super-secret'), false);

  const info = await admin.api('GET', '/api/profile/llm');
  assert.equal(info.json.allowed, true);
  assert.equal(info.json.configured, true);
  assert.equal(info.json.source, 'user');
  assert.equal(JSON.stringify(info.json).includes('sk-super-secret'), false);
});

test('copilot uses the user config when the env is unconfigured', async () => {
  clearEnvConfig();
  captured.length = 0;
  const res = await admin.api('POST', '/api/copilot/generate-assertions', {
    requestId,
    response: RESPONSE_SNAPSHOT,
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].config.model, 'gpt-4o-mini');
  assert.equal(captured[0].config.source, 'user');
});

test('DELETE forgets the config and status falls back to unconfigured', async () => {
  const del = await admin.api('DELETE', '/api/profile/llm');
  assert.equal(del.status, 200);
  const info = await admin.api('GET', '/api/profile/llm');
  assert.equal(info.json.configured, false);
  const status = await admin.api('GET', '/api/copilot/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.configured, false);
  assert.equal(status.json.source, 'none');
});
