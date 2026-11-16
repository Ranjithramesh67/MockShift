'use strict';

// File blocks (Docs): content { src, fileName, mime?, caption? }. src is an
// http(s) URL or a data: URL. Decoded payload must be <= 10 MB.

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
    email: 'docfileadmin@test.io',
    password: 'adminpass123',
    name: 'Doc File Admin',
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

const PDF_DATA = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 file').toString('base64')}`;
const FILE = {
  type: 'file',
  content: {
    src: PDF_DATA,
    fileName: 'spec.pdf',
    mime: 'application/pdf',
    caption: 'API spec',
  },
};

test('a file block round-trips through save and read', async () => {
  const admin = globalThis.__admin;
  const pageId = await newPage('File round-trip');

  const saved = await saveBlocks(pageId, [{ id: null, ...FILE }]);
  assert.equal(saved.status, 200, `save failed: ${JSON.stringify(saved.json)}`);
  const stored = saved.json.blocks.find((b) => b.type === 'file');
  assert.ok(stored, 'file block stored');
  assert.equal(stored.content.fileName, 'spec.pdf');
  assert.equal(stored.content.mime, 'application/pdf');
  assert.equal(stored.content.caption, 'API spec');
  assert.equal(stored.content.src, PDF_DATA);

  const read = await admin.api('GET', `/api/docs/${pageId}`);
  assert.equal(read.status, 200);
  assert.equal(read.json.blocks.find((b) => b.type === 'file').content.fileName, 'spec.pdf');
});

test('file block accepts an http(s) URL', async () => {
  const pageId = await newPage('File url');
  const saved = await saveBlocks(pageId, [
    {
      id: null,
      type: 'file',
      content: { src: 'https://example.com/notes.docx', fileName: 'notes.docx' },
    },
  ]);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
});

test('file block rejects blank name, bad src, and oversized payload', async () => {
  const pageId = await newPage('File guardrails');

  const blankName = await saveBlocks(pageId, [
    { id: null, type: 'file', content: { src: PDF_DATA, fileName: '  ' } },
  ]);
  assert.equal(blankName.status, 400);

  const badSrc = await saveBlocks(pageId, [
    { id: null, type: 'file', content: { src: 'javascript:alert(1)', fileName: 'x.txt' } },
  ]);
  assert.equal(badSrc.status, 400);

  const emptySrc = await saveBlocks(pageId, [
    { id: null, type: 'file', content: { src: '', fileName: 'x.txt' } },
  ]);
  assert.equal(emptySrc.status, 400);

  const over = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64');
  const tooBig = await saveBlocks(pageId, [
    {
      id: null,
      type: 'file',
      content: { src: `data:application/octet-stream;base64,${over}`, fileName: 'big.bin' },
    },
  ]);
  assert.equal(tooBig.status, 400);
  assert.ok(/10 MB/i.test(tooBig.json.error));
});

test('markdown and html exports render the file link', async () => {
  const admin = globalThis.__admin;
  const pageId = await newPage('File export');
  const saved = await saveBlocks(pageId, [{ id: null, ...FILE }]);
  assert.equal(saved.status, 200);

  const md = await admin.apiText(`/api/docs/${pageId}/export?format=markdown`);
  assert.equal(md.status, 200);
  assert.ok(md.text.includes('[spec.pdf]('), 'markdown file link');
  assert.ok(md.text.includes('*API spec*'), 'markdown caption');

  const html = await admin.apiText(`/api/docs/${pageId}/export?format=html`);
  assert.equal(html.status, 200);
  assert.ok(html.text.includes('spec.pdf'), 'html filename');
  assert.ok(/download=/i.test(html.text), 'html download attribute');
});
