'use strict';

// Table blocks (Docs round 3, DR6): content.rows: string[][] with server-side
// size/cell guardrails, plus markdown/html/json export coverage.

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
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

let server;
let base;

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
  async function apiText(url) {
    const res = await fetch(`${base}${url}`, { headers: cookie ? { Cookie: cookie } : {} });
    return { status: res.status, text: await res.text() };
  }
  return { api, apiText };
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../src/api/server');
  server = await new Promise((resolve) => {
    const app = createApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'doctableadmin@test.io',
    password: 'adminpass123',
    name: 'Doc Table Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__admin = admin;
  const ws = await admin.api('GET', '/api/workspaces');
  globalThis.__wsId = ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

async function newPage(title) {
  const admin = globalThis.__admin;
  const res = await admin.api('POST', '/api/docs', { workspaceId: globalThis.__wsId, title });
  assert.equal(res.status, 201);
  return res.json.page.id;
}

async function saveBlocks(pageId, blocks) {
  return globalThis.__admin.api('PUT', `/api/docs/${pageId}/blocks`, { blocks });
}

const TABLE = {
  type: 'table',
  content: {
    rows: [
      ['Name', 'Method'],
      ['List pets', 'GET'],
      ['Create pet | special', 'POST'],
    ],
    caption: 'Pet endpoints',
  },
};

test('a table block round-trips through save and read', async () => {
  const admin = globalThis.__admin;
  const pageId = await newPage('Table round-trip');

  const saved = await saveBlocks(pageId, [{ id: null, ...TABLE }]);
  assert.equal(saved.status, 200, `save failed: ${JSON.stringify(saved.json)}`);
  const stored = saved.json.blocks.find((b) => b.type === 'table');
  assert.ok(stored, 'table block stored');
  assert.deepEqual(stored.content.rows, TABLE.content.rows);
  assert.equal(stored.content.caption, 'Pet endpoints');

  const read = await admin.api('GET', `/api/docs/${pageId}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.json.blocks.find((b) => b.type === 'table').content.rows, TABLE.content.rows);
});

test('table guardrails reject oversized / malformed content', async () => {
  const pageId = await newPage('Table guardrails');

  const tooManyRows = await saveBlocks(pageId, [
    { id: null, type: 'table', content: { rows: Array.from({ length: 51 }, () => ['x']) } },
  ]);
  assert.equal(tooManyRows.status, 400);
  assert.ok(/at most 50 rows/.test(tooManyRows.json.error));

  const tooManyCols = await saveBlocks(pageId, [
    { id: null, type: 'table', content: { rows: [Array.from({ length: 13 }, () => 'x')] } },
  ]);
  assert.equal(tooManyCols.status, 400);
  assert.ok(/at most 12 columns/.test(tooManyCols.json.error));

  const nonString = await saveBlocks(pageId, [
    { id: null, type: 'table', content: { rows: [['ok', 5]] } },
  ]);
  assert.equal(nonString.status, 400);
  assert.ok(/cells must be strings/.test(nonString.json.error));

  const emptyRows = await saveBlocks(pageId, [{ id: null, type: 'table', content: { rows: [] } }]);
  assert.equal(emptyRows.status, 400);

  const emptyCell = await saveBlocks(pageId, [{ id: null, type: 'table', content: { rows: [[]] } }]);
  assert.equal(emptyCell.status, 400);

  const longCell = await saveBlocks(pageId, [
    { id: null, type: 'table', content: { rows: [['x'.repeat(2001)]] } },
  ]);
  assert.equal(longCell.status, 400);
  assert.ok(/at most 2000 characters/.test(longCell.json.error));
});

test('markdown, html and json exports render the table', async () => {
  const admin = globalThis.__admin;
  const pageId = await newPage('Table export');
  const saved = await saveBlocks(pageId, [{ id: null, ...TABLE }]);
  assert.equal(saved.status, 200);

  const md = await admin.apiText(`/api/docs/${pageId}/export?format=markdown`);
  assert.equal(md.status, 200);
  assert.ok(md.text.includes('| Name | Method |'), 'markdown header row');
  assert.ok(md.text.includes('| --- | --- |'), 'markdown separator row');
  assert.ok(md.text.includes('\\|'), 'pipe inside a cell is escaped');
  assert.ok(md.text.includes('*Pet endpoints*'), 'markdown caption');

  const html = await admin.apiText(`/api/docs/${pageId}/export?format=html`);
  assert.equal(html.status, 200);
  assert.ok(html.text.includes('<table>'), 'html table element');
  assert.ok(html.text.includes('<th>Name</th>'), 'html header cell');
  assert.ok(html.text.includes('<td>GET</td>'), 'html body cell');
  assert.ok(html.text.includes('<caption>Pet endpoints</caption>'), 'html caption');

  const json = await admin.apiText(`/api/docs/${pageId}/export?format=json`);
  assert.equal(json.status, 200);
  assert.ok(json.text.includes('"table"'), 'json export carries the block type');
});
