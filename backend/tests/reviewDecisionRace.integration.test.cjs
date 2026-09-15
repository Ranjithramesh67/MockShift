'use strict';

// MED-5 — two reviewers deciding the same review concurrently used to both pass
// the status pre-check and both UPDATE the row, firing two rounds of
// notifications/audit. The UPDATE now carries `AND status = 'pending'`; the
// losing decision gets a 409.
//
// The test pins the review row FOR UPDATE in a second session so both decision
// requests read it as pending and then queue on their status UPDATE. Releasing
// the lock lets the first commit and the second run against an already-decided
// row: pre-fix it overwrote it (two audited decisions), post-fix it 409s.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;
let user;
let projectId;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  user = await signupAndLogin(base, 'review-race@test.io', 'reviewpass123', 'Review Racer');
  const ws = await user.client.api('GET', '/api/workspaces');
  const tree = await user.client.api('GET', `/api/workspaces/${ws.json.workspaces[0].id}/content`);
  projectId = tree.json.projects[0].id;
});

after(async () => {
  if (closeApp) await closeApp();
});

function lockClient() {
  return new Client({
    host: '127.0.0.1',
    port: Number(process.env.INTEGRATION_PGPORT || process.env.PGPORT || 5432),
    user: 'postgres',
    password: 'postgres',
    database: process.env.INTEGRATION_PGDATABASE || 'apihub',
  });
}

function scalar(sql) {
  const match = psql(sql).match(/^\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : NaN;
}

async function createPendingReview(name) {
  const col = await user.client.api('POST', '/api/collections', { projectId, name });
  assert.equal(col.status, 201);
  const collectionId = col.json.collection.id;
  const review = await user.client.api('POST', '/api/reviews', { collectionId, reviewerId: user.id });
  assert.equal(review.status, 201, JSON.stringify(review.json));
  return { collectionId, reviewId: review.json.review.id };
}

test('concurrent decisions settle to a single winner and one audit entry', async () => {
  const { collectionId, reviewId } = await createPendingReview('race review');

  const lock = lockClient();
  await lock.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM collection_reviews WHERE id = $1 FOR UPDATE', [reviewId]);

  const approveP = user.client.api('POST', `/api/reviews/${reviewId}/decision`, { decision: 'approved' });
  await sleep(400);
  const changesP = user.client.api('POST', `/api/reviews/${reviewId}/decision`, {
    decision: 'changes_requested',
    comment: 'later',
  });
  await sleep(400);
  await lock.query('COMMIT');
  await lock.end();

  const [approve, changes] = await Promise.all([approveP, changesP]);
  const winners = [approve, changes].filter((r) => r.status === 200);
  const losers = [approve, changes].filter((r) => r.status === 409);
  assert.equal(winners.length, 1, `expected one winner, got ${approve.status}/${changes.status}`);
  assert.equal(losers.length, 1, `expected one 409, got ${approve.status}/${changes.status}`);

  const finalStatus = await user.client.api('GET', `/api/reviews?collectionId=${collectionId}`);
  assert.equal(finalStatus.json.status, winners[0].json.status);

  const audits = scalar(
    `SELECT count(*) FROM audit_logs WHERE action = 'decide_review' AND entity_id = '${collectionId}'`
  );
  assert.equal(audits, 1, 'only the winning decision must be audited');
});

test('a review that is already decided cannot be decided again', async () => {
  const { reviewId } = await createPendingReview('decided once');
  const first = await user.client.api('POST', `/api/reviews/${reviewId}/decision`, { decision: 'approved' });
  assert.equal(first.status, 200);

  const second = await user.client.api('POST', `/api/reviews/${reviewId}/decision`, { decision: 'changes_requested' });
  assert.equal(second.status, 409);
});
