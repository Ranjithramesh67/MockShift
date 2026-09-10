'use strict';

// ============================================================================
// Collaboration round (E5/P5) integration tests:
//   - comment threads on a request/collection (list, create, reply, resolve)
//   - collection review flow (request -> approve / request changes)
//   - version snapshots + diff
//
// The app is booted in-process. Because server.js is a coordinator-owned file,
// this suite mounts the exact routers it needs on a fresh Express app rather
// than depending on the coordinator having added the mount lines yet. The DB
// reset + migration scaffolding matches docsTables.integration.test.cjs.
// ============================================================================

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
  return { api };
}

function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/auth', require('../src/api/routes/auth'));
  app.use('/api/workspaces', require('../src/api/routes/workspaces'));
  app.use('/api', require('../src/api/routes/content'));
  app.use('/api', require('../src/api/routes/projects'));
  app.use('/api', require('../src/api/routes/notifications'));
  app.use('/api', require('../src/api/routes/comments'));
  app.use('/api', require('../src/api/routes/reviews'));
  app.use('/api', require('../src/api/routes/versions'));
  return app;
}

let admin;
let reviewer;
let stranger;
let projectId;

async function newCollection(name) {
  const res = await admin.api('POST', '/api/collections', { projectId, name });
  assert.equal(res.status, 201, `create collection ${name}`);
  return res.json.collection.id;
}

async function newRequest(collectionId, name) {
  const res = await admin.api('POST', '/api/requests', {
    collectionId,
    name,
    method: 'GET',
    url: `https://example.test/${name}`,
  });
  assert.equal(res.status, 201, `create request ${name}`);
  return res.json.request.id;
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

  server = await new Promise((resolve) => {
    const app = buildApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'collabadmin@test.io',
    password: 'adminpass123',
    name: 'Collab Admin',
  });
  assert.equal(signup.status, 201, 'admin signup');

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  projectId = content.json.projects.find((p) => p.name === 'Default Project').id;

  reviewer = makeClient();
  const rSignup = await reviewer.api('POST', '/api/auth/signup', {
    email: 'collabreviewer@test.io',
    password: 'reviewerpass123',
    name: 'Collab Reviewer',
  });
  assert.equal(rSignup.status, 201, 'reviewer signup');
  const reviewerId = rSignup.json.user.user.id;
  const add = await admin.api('POST', `/api/projects/${projectId}/members`, { userId: reviewerId, role: 'EDITOR' });
  assert.equal(add.status, 200, `grant reviewer project access: ${JSON.stringify(add.json)}`);

  stranger = makeClient();
  const sSignup = await stranger.api('POST', '/api/auth/signup', {
    email: 'collabstranger@test.io',
    password: 'strangerpass123',
    name: 'Collab Stranger',
  });
  assert.equal(sSignup.status, 201, 'stranger signup');

  globalThis.__reviewerId = reviewerId;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

// ------------------------------------------------------------------ Comments

test('comment threads: create, reply, list, resolve and unresolve', async () => {
  const col = await newCollection('Comments Col');
  const req = await newRequest(col, 'comment-target');

  const created = await admin.api('POST', '/api/comments', {
    targetType: 'request',
    targetId: req,
    body: '  Please double-check the auth header.  ',
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.comment.body, 'Please double-check the auth header.');
  assert.equal(created.json.comment.resolved, false);
  assert.ok(created.json.comment.author.id, 'author id present');
  assert.ok(created.json.comment.createdAt, 'timestamp present');
  const rootId = created.json.comment.id;

  const reply = await admin.api('POST', '/api/comments', {
    targetType: 'request',
    targetId: req,
    parentId: rootId,
    body: 'Fixed.',
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  assert.equal(reply.json.comment.parentId, rootId);

  const listAsReviewer = await reviewer.api('GET', `/api/comments?targetType=request&targetId=${req}`);
  assert.equal(listAsReviewer.status, 200);
  assert.equal(listAsReviewer.json.comments.length, 1);
  assert.equal(listAsReviewer.json.comments[0].id, rootId);
  assert.equal(listAsReviewer.json.comments[0].replies.length, 1);
  assert.equal(listAsReviewer.json.comments[0].replies[0].body, 'Fixed.');
  assert.equal(listAsReviewer.json.count, 2);

  const resolved = await reviewer.api('POST', `/api/comments/${rootId}/resolve`);
  assert.equal(resolved.status, 200, JSON.stringify(resolved.json));
  assert.equal(resolved.json.comment.resolved, true);
  assert.equal(resolved.json.comment.resolvedBy.id, globalThis.__reviewerId);

  const unresolved = await admin.api('POST', `/api/comments/${rootId}/unresolve`);
  assert.equal(unresolved.status, 200);
  assert.equal(unresolved.json.comment.resolved, false);
});

test('comments: validation and access gating', async () => {
  const col = await newCollection('Comments Guard Col');
  const req = await newRequest(col, 'guard-target');

  const empty = await admin.api('POST', '/api/comments', { targetType: 'request', targetId: req, body: '   ' });
  assert.equal(empty.status, 400);

  const badType = await admin.api('GET', `/api/comments?targetType=workspace&targetId=${req}`);
  assert.equal(badType.status, 400);

  const missingTarget = await admin.api('POST', '/api/comments', {
    targetType: 'request',
    targetId: '00000000-0000-0000-0000-000000000000',
    body: 'hi',
  });
  assert.equal(missingTarget.status, 404);

  const noAccessList = await stranger.api('GET', `/api/comments?targetType=request&targetId=${req}`);
  assert.equal(noAccessList.status, 403);

  const noAccessCreate = await stranger.api('POST', '/api/comments', {
    targetType: 'request',
    targetId: req,
    body: 'sneaky',
  });
  assert.equal(noAccessCreate.status, 403);

  const ok = await admin.api('POST', '/api/comments', { targetType: 'collection', targetId: col, body: 'Collection note' });
  assert.equal(ok.status, 201);
  const replyToReply = await admin.api('POST', '/api/comments', {
    targetType: 'collection',
    targetId: col,
    parentId: ok.json.comment.id,
    body: 'nested',
  });
  assert.equal(replyToReply.status, 201);
  const tooDeep = await admin.api('POST', '/api/comments', {
    targetType: 'collection',
    targetId: col,
    parentId: replyToReply.json.comment.id,
    body: 'too deep',
  });
  assert.equal(tooDeep.status, 400);
  assert.match(tooDeep.json.error, /one level/);
});

// ------------------------------------------------------------------- Reviews

test('review flow: request, request changes, approve; status derives from latest', async () => {
  const col = await newCollection('Review Col');

  const reqReview = await admin.api('POST', '/api/reviews', {
    collectionId: col,
    reviewerId: globalThis.__reviewerId,
    comment: 'Please review before release',
  });
  assert.equal(reqReview.status, 201, JSON.stringify(reqReview.json));
  assert.equal(reqReview.json.status, 'pending');
  assert.equal(reqReview.json.review.reviewer.id, globalThis.__reviewerId);
  const reviewId = reqReview.json.review.id;

  const listed = await admin.api('GET', `/api/reviews?collectionId=${col}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.status, 'pending');
  assert.equal(listed.json.reviews.length, 1);

  const status = await admin.api('GET', `/api/reviews/collections/${col}/status`);
  assert.equal(status.status, 200);
  assert.equal(status.json.status, 'pending');

  const duplicate = await admin.api('POST', '/api/reviews', { collectionId: col, reviewerId: globalThis.__reviewerId });
  assert.equal(duplicate.status, 409);

  const badDecision = await reviewer.api('POST', `/api/reviews/${reviewId}/decision`, { decision: 'reject' });
  assert.equal(badDecision.status, 400);

  const changes = await reviewer.api('POST', `/api/reviews/${reviewId}/decision`, {
    decision: 'changes_requested',
    comment: 'Missing tests',
  });
  assert.equal(changes.status, 200, JSON.stringify(changes.json));
  assert.equal(changes.json.status, 'changes_requested');
  assert.equal(changes.json.review.decisionComment, 'Missing tests');

  const decideAgain = await reviewer.api('POST', `/api/reviews/${reviewId}/decision`, { decision: 'approved' });
  assert.equal(decideAgain.status, 409);

  const second = await admin.api('POST', '/api/reviews', { collectionId: col, reviewerId: globalThis.__reviewerId });
  assert.equal(second.status, 201);

  const strangerDecision = await stranger.api('POST', `/api/reviews/${second.json.review.id}/decision`, {
    decision: 'approved',
  });
  assert.equal(strangerDecision.status, 403);

  const approved = await reviewer.api('POST', `/api/reviews/${second.json.review.id}/decision`, { decision: 'approved' });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, 'approved');

  const finalStatus = await admin.api('GET', `/api/reviews/collections/${col}/status`);
  assert.equal(finalStatus.json.status, 'approved');
});

test('reviews: reviewer must have project access; strangers cannot read', async () => {
  const col = await newCollection('Review Guard Col');

  const noAccessStatus = await stranger.api('GET', `/api/reviews/collections/${col}/status`);
  assert.equal(noAccessStatus.status, 403);

  const noAccessList = await stranger.api('GET', `/api/reviews?collectionId=${col}`);
  assert.equal(noAccessList.status, 403);

  const unknownReviewer = await admin.api('POST', '/api/reviews', {
    collectionId: col,
    reviewerId: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(unknownReviewer.status, 404);
});

// ------------------------------------------------------------------ Versions

test('version snapshots and diff detect added and changed requests', async () => {
  const col = await newCollection('Version Col');
  const r1 = await newRequest(col, 'version-a');
  await newRequest(col, 'version-b');

  const v1 = await admin.api('POST', '/api/versions', { collectionId: col, label: 'baseline' });
  assert.equal(v1.status, 201, JSON.stringify(v1.json));
  assert.equal(v1.json.version.versionNumber, 1);
  assert.equal(v1.json.version.requestCount, 2);
  assert.equal(v1.json.version.label, 'baseline');

  const rename = await admin.api('PUT', `/api/requests/${r1}`, { name: 'version-a-renamed' });
  assert.equal(rename.status, 200, JSON.stringify(rename.json));

  await newRequest(col, 'version-c');

  const v2 = await admin.api('POST', '/api/versions', { collectionId: col });
  assert.equal(v2.status, 201);
  assert.equal(v2.json.version.versionNumber, 2);
  assert.equal(v2.json.version.requestCount, 3);

  const list = await admin.api('GET', `/api/versions?collectionId=${col}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.versions.length, 2);
  assert.equal(list.json.versions[0].versionNumber, 2);

  const diff = await admin.api(
    'GET',
    `/api/versions/diff?collectionId=${col}&from=${v1.json.version.id}&to=${v2.json.version.id}`
  );
  assert.equal(diff.status, 200, JSON.stringify(diff.json));
  assert.equal(diff.json.diff.added.length, 1);
  assert.equal(diff.json.diff.added[0].name, 'version-c');
  assert.equal(diff.json.diff.removed.length, 0);
  assert.equal(diff.json.diff.changed.length, 1);
  assert.equal(diff.json.diff.changed[0].id, r1);
  assert.ok(diff.json.diff.changed[0].fields.some((f) => f.field === 'name'));

  const detail = await admin.api('GET', `/api/versions/${v1.json.version.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.version.snapshot.requests.length, 2);
  assert.equal(detail.json.version.snapshot.collection.id, col);

  const noAccess = await stranger.api('GET', `/api/versions?collectionId=${col}`);
  assert.equal(noAccess.status, 403);

  const badCollection = await admin.api('GET', `/api/versions?collectionId=00000000-0000-0000-0000-000000000000`);
  assert.equal(badCollection.status, 404);
});

test('version save requires editor access', async () => {
  const col = await newCollection('Version Guard Col');
  await newRequest(col, 'version-guard');
  const denied = await stranger.api('POST', '/api/versions', { collectionId: col });
  assert.equal(denied.status, 403);
});

// -------------------------------------------------------- Pure diff helper

test('collabDiff.diffSnapshots classifies added, removed and changed', () => {
  const { diffSnapshots } = require('../src/api/collabDiff');
  const from = {
    collection: { id: 'c1', name: 'C', projectId: 'p1' },
    requests: [
      { id: 'a', name: 'Alpha', method: 'GET', url: '/a' },
      { id: 'b', name: 'Bravo', method: 'POST', url: '/b', headers: [{ key: 'X', value: '1' }] },
      { id: 'd', name: 'Delta', method: 'GET', url: '/d' },
    ],
  };
  const to = {
    collection: { id: 'c1', name: 'C', projectId: 'p1' },
    requests: [
      { id: 'a', name: 'Alpha Renamed', method: 'GET', url: '/a' },
      { id: 'b', name: 'Bravo', method: 'POST', url: '/b', headers: [{ key: 'X', value: '1' }] },
      { id: 'e', name: 'Echo', method: 'DELETE', url: '/e' },
    ],
  };
  const diff = diffSnapshots(from, to);
  assert.deepEqual(diff.added.map((r) => r.id), ['e']);
  assert.deepEqual(diff.removed.map((r) => r.id), ['d']);
  assert.deepEqual(diff.changed.map((r) => r.id), ['a']);
  assert.equal(diff.changed[0].fields[0].field, 'name');
  assert.equal(diff.counts.unchanged, 1);
  assert.equal(diff.counts.fromTotal, 3);
  assert.equal(diff.counts.toTotal, 3);
});
