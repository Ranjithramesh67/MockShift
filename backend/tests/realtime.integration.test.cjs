'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;
let userA;
let userB;
let collectionId;

// Create a workspace/project/collection owned by `owner` and return the ids.
// A new workspace only auto-creates a "Default Project" (no collection), and
// GET /content returns a FLAT collections list — so collections must be
// created explicitly and read from `collection.id`, not
// `projects[0].collections[0]`.
async function makeSharedCollection(owner, name) {
  const ws = await owner.client.api('POST', '/api/workspaces', { name });
  assert.equal(ws.status, 201, `workspace failed: ${JSON.stringify(ws.json)}`);
  const tree = await owner.client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  assert.equal(tree.status, 200, `content failed: ${JSON.stringify(tree.json)}`);
  const projectId = tree.json.projects[0].id;
  const col = await owner.client.api('POST', '/api/collections', {
    projectId,
    name: `${name} collection`,
  });
  assert.equal(col.status, 201, `collection failed: ${JSON.stringify(col.json)}`);
  return { projectId, collectionId: col.json.collection.id };
}

// Open an SSE stream and return a reader with nextEvent(predicate, timeout).
const openStreams = [];

async function openSse(cookie, path) {
  const controller = new AbortController();
  openStreams.push(controller);
  const res = await fetch(`${base}${path}`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  const queue = mkReader(res);
  return { res, controller, queue, read: queue };
}

function mkReader(res) {
  const queue = [];
  let buffer = '';
  (async () => {
    for await (const chunk of res.body) {
      buffer += Buffer.from(chunk).toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) {
          try { queue.push(JSON.parse(dataLine.slice(5).trim())); } catch { /* ignore */ }
        }
      }
    }
  })().catch(() => {});
  return queue;
}

async function nextEvent(queue, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = queue.findIndex((e) => predicate(e));
    if (idx >= 0) return queue.splice(idx, 1)[0];
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for SSE event');
}

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
  userA = await signupAndLogin(base, 'rt-a@test.io', 'rtapass123', 'RT A');
  userB = await signupAndLogin(base, 'rt-b@test.io', 'rtbpass123', 'RT B');

  // Shared collection both users can read (userB is granted EDITOR so the
  // presence and reply-notification tests exercise a second real viewer).
  const shared = await makeSharedCollection(userA, 'RT Shared');
  collectionId = shared.collectionId;
  const addB = await userA.client.api('POST', `/api/projects/${shared.projectId}/members`, {
    userId: userB.id,
    role: 'EDITOR',
  });
  assert.equal(addB.status, 200, `grant access failed: ${JSON.stringify(addB.json)}`);
});

after(async () => {
  // Abort any stream left open by an expected-red test so server.close()
  // (which waits for open connections) does not hang the run.
  for (const controller of openStreams) {
    try { controller.abort(); } catch { /* ignore */ }
  }
  await new Promise((r) => setTimeout(r, 100));
  if (closeApp) await closeApp();
});

test('a room stream receives published events and reports presence', async () => {
  const stream = await openSse(userA.cookie, `/api/events?room=collection:${collectionId}`);
  assert.equal(stream.res.status, 200);
  assert.match(stream.res.headers.get('content-type'), /text\/event-stream/);

  const presence = await nextEvent(stream.queue, (e) => e.type === 'presence' && e.viewers.some((v) => v.id === userA.id));
  assert.ok(presence.viewers.some((v) => v.id === userA.id));

  const comment = await userA.client.api('POST', '/api/comments', {
    targetType: 'collection',
    targetId: collectionId,
    body: 'hello realtime',
  });
  assert.equal(comment.status, 201);
  const created = await nextEvent(stream.queue, (e) => e.type === 'comment:created');
  assert.equal(created.commentId, comment.json.comment.id);
  stream.controller.abort();
});

test('presence updates when a second viewer joins and leaves', async () => {
  const a = await openSse(userA.cookie, `/api/events?room=collection:${collectionId}`);
  await nextEvent(a.queue, (e) => e.type === 'presence');
  const b = await openSse(userB.cookie, `/api/events?room=collection:${collectionId}`);
  const two = await nextEvent(a.queue, (e) => e.type === 'presence' && e.viewers.length >= 2);
  assert.ok(two.viewers.some((v) => v.id === userB.id));
  b.controller.abort();
  const one = await nextEvent(a.queue, (e) => e.type === 'presence' && e.viewers.length === 1);
  assert.deepEqual(one.viewers.map((v) => v.id), [userA.id]);
  a.controller.abort();
});

test('user room delivers notifications', async () => {
  const stream = await openSse(userA.cookie, `/api/events?room=user:${userA.id}`);
  await nextEvent(stream.queue, (e) => e.type === 'presence' || e.type === 'connected');
  const root = await userA.client.api('POST', '/api/comments', {
    targetType: 'collection',
    targetId: collectionId,
    body: 'root comment',
  });
  assert.equal(root.status, 201, JSON.stringify(root.json));
  const reply = await userB.client.api('POST', '/api/comments', {
    targetType: 'collection',
    targetId: collectionId,
    body: 'reply to root',
    parentId: root.json.comment.id,
  });
  assert.equal(reply.status, 201);
  const note = await nextEvent(stream.queue, (e) => e.type === 'notification');
  assert.match(note.notification.title, /replied/i);
  assert.equal(note.notification.payload.source, 'collab');
  stream.controller.abort();
});

test('room authorization rejects other users and unknown rooms', async () => {
  const otherUserRoom = await fetch(`${base}/api/events?room=user:${userA.id}`, {
    headers: { Cookie: userB.cookie },
  });
  assert.equal(otherUserRoom.status, 403);
  const bad = await fetch(`${base}/api/events?room=not-a-room`, {
    headers: { Cookie: userA.cookie },
  });
  assert.equal(bad.status, 400);
});

test('comment resolve and review decision publish to the entity room', async () => {
  const stream = await openSse(userA.cookie, `/api/events?room=collection:${collectionId}`);
  await nextEvent(stream.queue, (e) => e.type === 'presence');

  const c = await userA.client.api('POST', '/api/comments', {
    targetType: 'collection',
    targetId: collectionId,
    body: 'to resolve',
  });
  await nextEvent(stream.queue, (e) => e.type === 'comment:created');
  const resolved = await userA.client.api('POST', `/api/comments/${c.json.comment.id}/resolve`);
  assert.equal(resolved.status, 200);
  const resolvedEvent = await nextEvent(stream.queue, (e) => e.type === 'comment:resolved');
  assert.equal(resolvedEvent.commentId, c.json.comment.id);

  const review = await userA.client.api('POST', '/api/reviews', { collectionId, comment: 'review please' });
  assert.equal(review.status, 201);
  await nextEvent(stream.queue, (e) => e.type === 'review:created');
  const decision = await userA.client.api('POST', `/api/reviews/${review.json.review.id}/decision`, {
    decision: 'approved',
    comment: 'lgtm',
  });
  assert.equal(decision.status, 200);
  const decided = await nextEvent(stream.queue, (e) => e.type === 'review:decided');
  assert.equal(decided.status, 'approved');
  stream.controller.abort();
});

test('saving a request publishes entity:updated to its room', async () => {
  const created = await userA.client.api('POST', '/api/requests', {
    collectionId,
    name: 'Live request',
    method: 'GET',
    url: 'https://example.com/live',
  });
  assert.equal(created.status, 201);
  const requestId = created.json.request.id;

  const stream = await openSse(userA.cookie, `/api/events?room=request:${requestId}`);
  await nextEvent(stream.queue, (e) => e.type === 'presence');

  const saved = await userA.client.api('PUT', `/api/requests/${requestId}`, {
    name: 'Live request edited',
  });
  assert.equal(saved.status, 200);
  const event = await nextEvent(stream.queue, (e) => e.type === 'entity:updated');
  assert.equal(event.entityId, requestId);
  assert.equal(event.entityType, 'request');
  assert.equal(event.by.id, userA.id);
  stream.controller.abort();
});

test('rolling back a request publishes entity:updated to its room', async () => {
  const created = await userA.client.api('POST', '/api/requests', {
    collectionId,
    name: 'Rollback live',
    method: 'GET',
    url: 'https://example.com/r1',
  });
  assert.equal(created.status, 201);
  const requestId = created.json.request.id;
  await userA.client.api('PUT', `/api/requests/${requestId}`, { url: 'https://example.com/r2' });

  const list = await userA.client.api('GET', `/api/requests/${requestId}/revisions`);
  const v1 = list.json.revisions.find((r) => r.revisionNumber === 1);

  const stream = await openSse(userA.cookie, `/api/events?room=request:${requestId}`);
  await nextEvent(stream.queue, (e) => e.type === 'presence');
  const rb = await userA.client.api('POST', `/api/requests/${requestId}/revisions/${v1.id}/rollback`);
  assert.equal(rb.status, 200, JSON.stringify(rb.json));
  const event = await nextEvent(stream.queue, (e) => e.type === 'entity:updated');
  assert.equal(event.entityId, requestId);
  assert.equal(event.entityType, 'request');
  assert.equal(event.by.id, userA.id);
  stream.controller.abort();
});
