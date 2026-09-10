'use strict';

// Confluence copy (Docs round 3, DR5): GET /docs/:pageId/export?format=confluence
// returns a neutral, un-themed HTML fragment (no page chrome / app theme) meant
// for the clipboard as text/html so a rich-text editor pastes headings, lists,
// code and tables without manual reformatting (O5).

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
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      text: await res.text(),
    };
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
    email: 'docconfadmin@test.io',
    password: 'adminpass123',
    name: 'Doc Confluence Admin',
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

test('confluence export is a neutral HTML fragment with rich blocks', async () => {
  const admin = globalThis.__admin;
  const pageId = await newPage('Confluence <Paste> & Co');
  const saved = await saveBlocks(pageId, [
    { id: null, type: 'heading', content: { text: 'Endpoints' } },
    { id: null, type: 'text', content: { text: 'Use <b>bold</b> & "quote"' } },
    { id: null, type: 'list', content: { style: 'bullet', items: ['Alpha', 'Beta'] } },
    { id: null, type: 'code', content: { language: 'http', code: 'GET /pets HTTP/1.1' } },
    {
      id: null,
      type: 'table',
      content: {
        rows: [
          ['Name', 'Method'],
          ['List pets', 'GET'],
        ],
        caption: 'Pet endpoints',
      },
    },
  ]);
  assert.equal(saved.status, 200, `save failed: ${JSON.stringify(saved.json)}`);

  const out = await admin.apiText(`/api/docs/${pageId}/export?format=confluence`);
  assert.equal(out.status, 200);
  assert.ok(/text\/html/.test(out.contentType), 'served as text/html');

  assert.ok(!out.text.includes('<!DOCTYPE'), 'no document doctype');
  assert.ok(!out.text.includes('<html'), 'no html shell');
  assert.ok(!out.text.includes('color-scheme'), 'no app theme');
  assert.ok(!out.text.includes('doc-card'), 'no brand chrome');

  assert.ok(out.text.startsWith('<h1>Confluence &lt;Paste&gt; &amp; Co</h1>'), 'title heading is escaped');
  assert.ok(out.text.includes('<h2>Endpoints</h2>'), 'heading block');
  assert.ok(out.text.includes('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quote&quot;'), 'text is escaped');
  assert.ok(out.text.includes('<ul><li>Alpha</li><li>Beta</li></ul>'), 'list block');
  assert.ok(out.text.includes('<pre><code>GET /pets HTTP/1.1</code></pre>'), 'code block');
  assert.ok(out.text.includes('<table>'), 'table block');
  assert.ok(out.text.includes('<th>Name</th>'), 'table header cell');
  assert.ok(out.text.includes('<td>GET</td>'), 'table body cell');
  assert.ok(out.text.includes('<caption>Pet endpoints</caption>'), 'table caption');
});

test('export format validation advertises and accepts confluence', async () => {
  const admin = globalThis.__admin;
  const pageId = await newPage('Confluence validation');

  const bad = await admin.apiText(`/api/docs/${pageId}/export?format=pdf`);
  assert.equal(bad.status, 400);
  assert.ok(/confluence/.test(bad.text), 'error lists confluence as a valid format');
});
