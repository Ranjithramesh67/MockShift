# Realtime Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight realtime layer to API Hub — live comment/review updates, a live notification bell, per-entity presence ("who is viewing"), and a concurrent-edit warning — using Server-Sent Events (SSE).

**Architecture:** A single authenticated `GET /api/events` endpoint streams server-sent events over an in-process pub/sub hub (`backend/src/api/realtime.js`). Each connection subscribes to one *room* (`user:<userId>`, `request:<id>`, `collection:<id>`, `doc:<id>`); the room is authorized with the same read helpers used elsewhere. Domain code publishes events to rooms: notifications publish to the recipient's user room, comments/reviews publish to their entity room, and request/doc saves publish an `entity:updated` event so clients with unsaved edits can warn the user. The browser opens one `EventSource` per room it cares about (cookie auth is sent automatically through the Next.js `/api` rewrite). Character-level co-editing (CRDT/OT) is explicitly **out of scope** for this plan.

**Tech Stack:** Express 5 (CommonJS), PostgreSQL (`pg`), Node `node:test`, Next.js 14 App Router, React 18, native `EventSource`.

## Global Constraints

- Backend raw SQL via `require('../db')`; no ORM.
- Do NOT add any new dependency. The transport is native SSE; the event bus is an in-process `EventEmitter` (the API server and its BullMQ workers run in one process — verified; there is no separate worker entrypoint).
- Reuse `canReadProject` / `canReadWorkspace` (`backend/src/api/access.js`) and `canReadPage` (`backend/src/api/routes/docs.js`) to authorize room subscriptions; do not re-derive permissions.
- Long-lived SSE connections authenticate via the existing `ah.session` cookie (same-origin through the Next rewrite). Bearer/`EventSource` machine clients are out of scope for v1.
- No global compression middleware exists; `GET /api/events` must set `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`.
- Publishing must never throw into request handlers: `realtime.publish` and every publish call site are best-effort (wrap in try/catch or rely on the hub's own try/catch), mirroring `notifyUser`'s never-throw contract.
- Frontend calls via `apiFetch`/`ApiError` where HTTP JSON is involved; `EventSource` is used directly for streams. Unit-testable FE helpers are CommonJS `.js` under `frontend/src/lib/` with tests in `frontend/src/lib/__tests__/*.test.cjs` (run by `node --test`).
- Testids kebab-case. Commit style Conventional Commits. Never stage `docs/superpowers/` or `frontend/tsconfig.tsbuildinfo`.
- Integration tests use the scratch Postgres cluster on port 5441: `PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/<spec>` and the shared harness `backend/tests/support/harness.cjs` (`startApp`, `makeClient`, `signupAndLogin`).
- The dev database is only touched by migration-free work: this plan adds **no** migration (the realtime hub is in-memory; presence is ephemeral). If a later task needs persistence, that is a separate plan.
- `REALTIME_HEARTBEAT_MS` env var overrides the SSE heartbeat (default `25000`).

---

## File Structure

- Create `backend/src/api/realtime.js` — in-process room pub/sub hub + presence roster (pure, no Express, no DB).
- Create `backend/src/api/__tests__/realtime.test.cjs` — unit tests for the hub.
- Create `backend/src/api/routes/events.js` — `GET /api/events` SSE endpoint + room authorization.
- Create `backend/tests/realtime.integration.test.cjs` — SSE delivery, presence, auth integration tests.
- Modify `backend/src/api/server.js` — mount `/api/events`.
- Modify `backend/src/api/notify.js` — publish `notification` events to the recipient's user room.
- Modify `backend/src/api/routes/comments.js` — use the shared notifier; publish comment events to the entity room.
- Modify `backend/src/api/routes/reviews.js` — use the shared notifier; publish review events to the collection room.
- Modify `backend/src/api/routes/content.js` — publish `entity:updated` on request save.
- Modify `backend/src/api/routes/docs.js` — publish `entity:updated` on doc page/block save.
- Create `frontend/src/lib/realtime.js` — pure FE helpers (room keys, SSE frame parsing, viewer labels).
- Create `frontend/src/lib/__tests__/realtime.test.cjs` — FE unit tests.
- Create `frontend/src/components/useRoomEvents.ts` — React hook wrapping `EventSource`.
- Modify `frontend/src/components/TopBar.tsx` — notification bell consumes the live user room (poll stays as fallback).
- Modify `frontend/src/components/collab/CollabPanel.tsx` — live refresh + presence.
- Modify `frontend/src/components/RequestConfigurator.tsx` — request presence + conflict banner.
- Modify `frontend/src/components/docs/DocsPageView.tsx` — doc presence + conflict banner.
- Modify `frontend/app/globals.css` — presence + conflict banner styles.
- Modify `docs/FEATURES.md`, `session_v2.md`.

---

## Task 1: Realtime pub/sub hub

**Files:**
- Create: `backend/src/api/realtime.js`
- Test: `backend/src/api/__tests__/realtime.test.cjs`

**Interfaces:**
- Produces: `roomKey(kind, id)` -> `string` (`kind` is `'user'|'request'|'collection'|'doc'`).
- Produces: `subscribe(room, subscriber)` -> `unsubscribe()`; subscriber is `{ userId, name, send }`.
- Produces: `publish(room, event)` -> `void` (attaches `at` ISO timestamp; never throws).
- Produces: `viewersFor(room)` -> `Array<{ id, name }>` (deduped by user id, insertion order).
- Produces: `subscriberCount(room)` -> `number`.
- Produces: `reset()` -> `void` (test helper).

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const realtime = require('../realtime');

beforeEach(() => realtime.reset());

test('publish delivers an event with a timestamp to every subscriber', () => {
  const a = [];
  const b = [];
  const unsubA = realtime.subscribe('collection:c1', { userId: 'u1', name: 'A', send: (e) => a.push(e) });
  realtime.subscribe('collection:c1', { userId: 'u2', name: 'B', send: (e) => b.push(e) });
  realtime.publish('collection:c1', { type: 'comment:created', commentId: 'x' });
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].type, 'comment:created');
  assert.equal(a[0].commentId, 'x');
  assert.match(a[0].at, /^\d{4}-\d{2}-\d{2}T/);
  unsubA();
  realtime.publish('collection:c1', { type: 'comment:deleted' });
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
});

test('publish to an empty or unknown room is a no-op', () => {
  assert.doesNotThrow(() => realtime.publish('doc:missing', { type: 'x' }));
});

test('a throwing subscriber cannot break delivery to others', () => {
  const good = [];
  realtime.subscribe('request:r1', { userId: 'u1', name: 'A', send: () => { throw new Error('boom'); } });
  realtime.subscribe('request:r1', { userId: 'u2', name: 'B', send: (e) => good.push(e) });
  realtime.publish('request:r1', { type: 'presence' });
  assert.equal(good.length, 1);
});

test('viewersFor dedupes by user id', () => {
  realtime.subscribe('doc:d1', { userId: 'u1', name: 'A', send() {} });
  realtime.subscribe('doc:d1', { userId: 'u1', name: 'A', send() {} });
  realtime.subscribe('doc:d1', { userId: 'u2', name: 'B', send() {} });
  assert.deepEqual(realtime.viewersFor('doc:d1'), [
    { id: 'u1', name: 'A' },
    { id: 'u2', name: 'B' },
  ]);
  assert.equal(realtime.subscriberCount('doc:d1'), 3);
});

test('roomKey formats room names', () => {
  assert.equal(realtime.roomKey('request', 'r1'), 'request:r1');
  assert.equal(realtime.roomKey('user', 'u1'), 'user:u1');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test src/api/__tests__/realtime.test.cjs`
Expected: FAIL — cannot find module `../realtime`.

- [ ] **Step 3: Implement**

```js
'use strict';

// ============================================================================
// In-process realtime pub/sub hub.
//
// The API process also hosts the BullMQ workers (see workflowService.js), so a
// plain in-memory room registry is sufficient: every publisher and every SSE
// subscriber live in this one process. If the deployment is ever split into
// separate worker processes, replace this module's transport with Redis
// pub/sub — the publish/subscribe interface is intentionally small.
//
// Rooms:
//   user:<userId>            per-user notifications
//   request:<requestId>      comments, presence, entity updates
//   collection:<id>          comments, reviews, presence
//   doc:<pageId>             presence, entity updates
// ============================================================================

function roomKey(kind, id) {
  return `${kind}:${id}`;
}

// room -> Map<subscriberId, { userId, name, send }>
const rooms = new Map();
let seq = 0;

function subscribe(room, subscriber) {
  if (!room || !subscriber || typeof subscriber.send !== 'function') return () => {};
  let subs = rooms.get(room);
  if (!subs) {
    subs = new Map();
    rooms.set(room, subs);
  }
  const id = `s${(seq += 1)}`;
  subs.set(id, subscriber);
  return () => {
    const current = rooms.get(room);
    if (!current) return;
    current.delete(id);
    if (current.size === 0) rooms.delete(room);
  };
}

function publish(room, event) {
  const subs = rooms.get(room);
  if (!subs) return;
  const payload = { ...event, at: new Date().toISOString() };
  for (const sub of subs.values()) {
    try {
      sub.send(payload);
    } catch (err) {
      // A broken connection must never break the publish loop.
      // eslint-disable-next-line no-console
      console.error('[realtime] subscriber send failed:', err.message);
    }
  }
}

function viewersFor(room) {
  const subs = rooms.get(room);
  if (!subs) return [];
  const byUser = new Map();
  for (const sub of subs.values()) {
    if (!sub.userId || byUser.has(sub.userId)) continue;
    byUser.set(sub.userId, { id: sub.userId, name: sub.name || null });
  }
  return [...byUser.values()];
}

function subscriberCount(room) {
  return rooms.get(room)?.size || 0;
}

function reset() {
  rooms.clear();
}

module.exports = { roomKey, subscribe, publish, viewersFor, subscriberCount, reset };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test src/api/__tests__/realtime.test.cjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/realtime.js backend/src/api/__tests__/realtime.test.cjs
git commit -m "feat(realtime): add in-process room pub/sub hub"
```

---

## Task 2: SSE endpoint

**Files:**
- Create: `backend/src/api/routes/events.js`
- Modify: `backend/src/api/server.js` (require + mount)
- Test: `backend/tests/realtime.integration.test.cjs`

**Interfaces:**
- Consumes: `roomKey`, `subscribe`, `publish`, `viewersFor` (Task 1); `requireAuth`, `canReadProject` (`access.js`); `canReadPage` (`routes/docs.js`).
- Produces: `GET /api/events?room=<kind>:<id>` -> `text/event-stream`. With no `room`, defaults to `user:<req.user.id>`.
- Produces: SSE event frames `event: message` + `data: <json>` where json is `{ type, at, ... }`. Presence frames have `type: 'presence'` and `viewers: [{ id, name }]`.
- Produces: room authorization helper `authorizeRoom(user, room)` -> `Promise<{ ok: true, room } | { ok: false, status, error }>` (used by tests indirectly; keep exported for potential reuse).

- [ ] **Step 1: Write the failing integration test**

```js
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
```

Note: a new workspace only auto-creates a "Default Project" — **not** a collection — and `GET /api/workspaces/:id/content` returns a FLAT `collections` array. The `makeSharedCollection` helper in `before` therefore creates the collection explicitly and reads `collection.id` from the `POST /api/collections` response. `userB` is granted `EDITOR` on the shared project via `POST /api/projects/:projectId/members` so the presence/reply-notification tests can exercise a second real viewer. `userA` is the first signup (platform ADMIN), so it may grant that membership.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs`
Expected: FAIL — `/api/events` returns 404.

- [ ] **Step 3: Implement the route**

```js
'use strict';

// ============================================================================
// GET /api/events?room=<kind>:<id> — Server-Sent Events stream.
//
// One connection = one room. With no room, the connection defaults to the
// caller's own `user:<id>` room (notifications). Entity rooms are authorized
// with the same read helpers used by the JSON routes.
//
// Frames: `event: message` + `data: <json>`; `data.type` is the event type and
// `data.at` an ISO timestamp. A `: ping` comment is sent on an interval to keep
// intermediaries from closing idle connections.
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, canReadProject } = require('../access');
const realtime = require('../realtime');
const docsRoutes = require('./docs');

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function heartbeatMs() {
  const n = Number(process.env.REALTIME_HEARTBEAT_MS);
  return Number.isFinite(n) && n > 0 ? n : 25000;
}

async function authorizeRoom(user, room) {
  const [kind, id] = String(room || '').split(':');
  if (!kind || !id || !UUID_RE.test(id)) {
    return { ok: false, status: 400, error: 'room must be user|request|collection|doc:<uuid>' };
  }
  if (kind === 'user') {
    return id === user.id ? { ok: true, room } : { ok: false, status: 403, error: 'No access to this room' };
  }
  if (kind === 'request') {
    const { rows } = await query(
      `SELECT c.project_id FROM api_requests ar JOIN collections c ON c.id = ar.collection_id WHERE ar.id = $1`,
      [id]
    );
    if (!rows[0]) return { ok: false, status: 404, error: 'Not found' };
    return (await canReadProject(user.id, rows[0].project_id))
      ? { ok: true, room }
      : { ok: false, status: 403, error: 'No access to this room' };
  }
  if (kind === 'collection') {
    const { rows } = await query(`SELECT project_id FROM collections WHERE id = $1`, [id]);
    if (!rows[0]) return { ok: false, status: 404, error: 'Not found' };
    return (await canReadProject(user.id, rows[0].project_id))
      ? { ok: true, room }
      : { ok: false, status: 403, error: 'No access to this room' };
  }
  if (kind === 'doc') {
    const { rows } = await query(
      `SELECT id, workspace_id, project_id, visibility, parent_id, created_by FROM doc_pages WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return { ok: false, status: 404, error: 'Not found' };
    return (await docsRoutes.canReadPage(user, rows[0]))
      ? { ok: true, room }
      : { ok: false, status: 403, error: 'No access to this room' };
  }
  return { ok: false, status: 400, error: 'Unknown room kind' };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const room = req.query.room ? String(req.query.room) : realtime.roomKey('user', req.user.id);
    const auth = await authorizeRoom(req.user, room);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const send = (event) => {
      if (res.writableEnded) return;
      res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = realtime.subscribe(room, { userId: req.user.id, name: req.user.name, send });
    realtime.publish(room, { type: 'presence', room, viewers: realtime.viewersFor(room) });

    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, heartbeatMs());

    req.on('close', () => {
      clearInterval(timer);
      unsubscribe();
      realtime.publish(room, { type: 'presence', room, viewers: realtime.viewersFor(room) });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.authorizeRoom = authorizeRoom;
```

- [ ] **Step 4: Mount in `server.js`**

Add `const eventsRoutes = require('./routes/events');` next to the other route requires, and add the mount right after `app.use('/api', notificationRoutes);`:

```js
app.use('/api/events', eventsRoutes);
```

- [ ] **Step 5: Run the integration test**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs`
Expected: the presence and room-authorization tests pass. **Two** tests are intentionally staged red and must be kept as-is (do not delete, weaken, or skip them): the **notifications** test passes only after Task 3 (nothing publishes `notification` yet), and the **delivery** test's final assertion waits for `comment:created`, which Task 4 publishes. They go green at Tasks 3 and 4 respectively. Committing a task with these two known-red tests is the plan's intended staging.

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/events.js backend/src/api/server.js backend/tests/realtime.integration.test.cjs
git commit -m "feat(realtime): add authenticated SSE events endpoint"
```

---

## Task 3: Stream notifications from the shared notifier

**Files:**
- Modify: `backend/src/api/notify.js`
- Modify: `backend/src/api/routes/comments.js` (remove the local `notifyUser`, import the shared one)
- Modify: `backend/src/api/routes/reviews.js` (remove the local `notifyUser`, import the shared one)

**Interfaces:**
- Consumes: `publish` (Task 1).
- Produces: `notifyUser` now publishes `{ type: 'notification', notification: <row> }` to `user:<userId>` in addition to inserting the row; still never throws and still a no-op for a missing `userId`.
- Produces: comments and reviews use the shared notifier (their insert behavior is unchanged apart from now including `payload`/`link` consistently).

- [ ] **Step 1: Update `notify.js`**

Replace the body of `notifyUser` so the insert returns the row and publishes it. Keep the exported names/signatures identical.

```js
const { query } = require('./db');
const { publish, roomKey } = require('./realtime');
```

```js
async function notifyUser(opts) {
  const { userId, title, body, kind, payload, link } = opts || {};
  if (!userId) return null;
  try {
    const { rows } = await query(
      `INSERT INTO notifications (user_id, title, body, kind, payload, link)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, title, body, kind, read, payload, link, created_at`,
      [userId, title, body || null, kind || 'info', JSON.stringify(payload || {}), link || null]
    );
    const notification = rows[0];
    publish(roomKey('user', userId), { type: 'notification', notification });
    return notification;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] insert failed:', err.message);
    return null;
  }
}
```

- [ ] **Step 2: Point comments at the shared notifier**

In `backend/src/api/routes/comments.js`:
- Delete the local `async function notifyUser({...}) { ... }` block (currently around lines 80-92).
- Add to the requires: `const { notifyUser } = require('../notify');`
- The existing call site (`userId: parent.author_id, title, body, kind: 'info', link`) keeps working unchanged — the shared notifier accepts the same fields.

- [ ] **Step 3: Point reviews at the shared notifier**

In `backend/src/api/routes/reviews.js`:
- Delete the local `async function notifyUser({...}) { ... }` block (currently around lines 64-76).
- Add to the requires: `const { notifyUser } = require('../notify');`
- Both existing call sites (request-review at ~line 199, decision at ~line 262) keep working.

- [ ] **Step 4: Add a unit test for the publish-on-notify behavior**

Create `backend/src/api/__tests__/notifyRealtime.test.cjs`:

```js
'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

test('notifyUser publishes a notification event to the user room', async () => {
  const realtime = require('../realtime');
  const db = require('../db');
  mock.method(db, 'query', async () => ({
    rows: [{ id: 'n1', user_id: 'u1', title: 'Hi', body: null, kind: 'info', read: false, payload: {}, link: null, created_at: new Date().toISOString() }],
  }));
  const seen = [];
  const unsub = realtime.subscribe('user:u1', { userId: 'u1', name: 'U', send: (e) => seen.push(e) });
  const { notifyUser } = require('../notify');
  await notifyUser({ userId: 'u1', title: 'Hi', kind: 'info' });
  unsub();
  mock.restoreAll();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'notification');
  assert.equal(seen[0].notification.id, 'n1');
});
```

Run: `cd backend && node --test src/api/__tests__/notifyRealtime.test.cjs`
Expected: PASS after the notify.js change (FAIL — no event — before it).

- [ ] **Step 5: Re-run the Task 2 integration test**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs`
Expected: 3 tests PASS now (including the notification test). The **delivery** test remains red until Task 4 publishes `comment:created` — that is the expected staging; do not weaken it.

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/notify.js backend/src/api/routes/comments.js backend/src/api/routes/reviews.js backend/src/api/__tests__/notifyRealtime.test.cjs
git commit -m "feat(realtime): stream notifications and share the notify helper"
```

---

## Task 4: Publish comment and review events to entity rooms

**Files:**
- Modify: `backend/src/api/routes/comments.js`
- Modify: `backend/src/api/routes/reviews.js`
- Test: extend `backend/tests/realtime.integration.test.cjs`

**Interfaces:**
- Consumes: `publish`, `roomKey` (Task 1).
- Produces: comment lifecycle events on room `request:<id>` / `collection:<id>`:
  - `{ type: 'comment:created', commentId }`
  - `{ type: 'comment:resolved', commentId }`
  - `{ type: 'comment:unresolved', commentId }`
  - `{ type: 'comment:deleted', commentId }`
- Produces: review events on room `collection:<id>`:
  - `{ type: 'review:created', reviewId }`
  - `{ type: 'review:decided', reviewId, status }`

- [ ] **Step 1: Add the failing assertions to the integration test**

Append to `backend/tests/realtime.integration.test.cjs`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs`
Expected: FAIL — times out waiting for `comment:resolved`.

- [ ] **Step 3: Publish comment events**

In `backend/src/api/routes/comments.js` add to the requires: `const { publish, roomKey } = require('../realtime');`

After the comment insert succeeds in `POST /comments` (after `const row = await commentRow(created.rows[0].id);`):

```js
publish(roomKey(type, targetId), { type: 'comment:created', commentId: row.id });
```

In the resolve / unresolve / delete handlers, immediately before `res.json(...)`, publish the matching event. Resolve/unresolve go through `setResolved`; publish in each route after it returns (use the `commentId` param as the `commentId`):

```js
// after setResolved(...) in POST /comments/:commentId/resolve
publish(roomKey(row.target_type, row.target_id), { type: 'comment:resolved', commentId: row.id });
```

Resolve the row's `target_type`/`target_id` from the handler's existing lookup; if the handler only loads the comment in `setResolved`, return the row from `setResolved` (update its return value to the updated row) rather than adding a second query. Apply the same pattern for `unresolve` (`comment:unresolved`) and `delete` (`comment:deleted`, using the row fetched before deletion).

- [ ] **Step 4: Publish review events**

In `backend/src/api/routes/reviews.js` add to the requires: `const { publish, roomKey } = require('../realtime');`

After the review insert in `POST /reviews` (before `res.status(201)...`):

```js
publish(roomKey('collection', collectionId), { type: 'review:created', reviewId: row.id });
```

After the decision update in `POST /reviews/:reviewId/decision` (before `res.json(...)`):

```js
publish(roomKey('collection', collectionId), { type: 'review:decided', reviewId: row.id, status: row.status });
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/comments.js backend/src/api/routes/reviews.js backend/tests/realtime.integration.test.cjs
git commit -m "feat(realtime): publish comment and review events to entity rooms"
```

---

## Task 5: Publish `entity:updated` on request and doc saves

**Files:**
- Modify: `backend/src/api/routes/content.js` (`PUT /requests/:requestId`, `:597`)
- Modify: `backend/src/api/routes/docs.js` (`PUT /:pageId` `:1600`, `PUT /:pageId/blocks` `:1749`)
- Test: extend `backend/tests/realtime.integration.test.cjs`

**Interfaces:**
- Consumes: `publish`, `roomKey` (Task 1).
- Produces: `{ type: 'entity:updated', entityType: 'request' | 'doc', entityId, by: { id, name } }` on `request:<id>` / `doc:<id>`.

- [ ] **Step 1: Add the failing assertion**

Append to `backend/tests/realtime.integration.test.cjs`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs`
Expected: FAIL — times out waiting for `entity:updated`.

- [ ] **Step 3: Publish on request save**

In `backend/src/api/routes/content.js` add to the requires: `const { publish, roomKey } = require('../realtime');`

At the end of `PUT /requests/:requestId`, after the update succeeds and before `res.json(...)`:

```js
publish(roomKey('request', requestId), {
  type: 'entity:updated',
  entityType: 'request',
  entityId: requestId,
  by: { id: req.user.id, name: req.user.name || null },
});
```

- [ ] **Step 4: Publish on doc save**

In `backend/src/api/routes/docs.js` add to the requires: `const { publish, roomKey } = require('../realtime');`

At the end of `PUT /:pageId` and `PUT /:pageId/blocks`, after the write succeeds and before `res.json(...)`:

```js
publish(roomKey('doc', req.params.pageId), {
  type: 'entity:updated',
  entityType: 'doc',
  entityId: req.params.pageId,
  by: { id: req.user.id, name: req.user.name || null },
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the existing collab/content regression suites**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/collab.integration.test.cjs tests/docsShareAudiences.integration.test.cjs`
Expected: PASS (publishing must not alter responses).

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/routes/content.js backend/src/api/routes/docs.js backend/tests/realtime.integration.test.cjs
git commit -m "feat(realtime): publish entity updates on request and doc saves"
```

---

## Task 6: Frontend realtime helpers + `useRoomEvents` hook

**Files:**
- Create: `frontend/src/lib/realtime.js`
- Create: `frontend/src/lib/__tests__/realtime.test.cjs`
- Create: `frontend/src/components/useRoomEvents.ts`

**Interfaces:**
- Produces: `roomFor(kind, id)` -> `string | null` (null when `id` is falsy).
- Produces: `eventsUrl(room)` -> `string` (`/api/events?room=<encoded>`; no room -> `/api/events`).
- Produces: `parseSseFrame(frame)` -> `object | null` (parses a raw `event:`/`data:` frame block, returns the parsed JSON from its `data:` line, or null).
- Produces: `viewerSummary(viewers, selfId)` -> `{ count, label }` where `count` excludes self and label is e.g. `'2 others viewing'` / `'You are the only one here'`.
- Produces: `useRoomEvents(room: string | null, onEvent?: (event: any) => void)` -> `{ connected: boolean, viewers: { id: string; name: string | null }[] }`.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/lib/__tests__/realtime.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomFor, eventsUrl, parseSseFrame, viewerSummary } = require('../realtime.js');

test('roomFor builds rooms and rejects missing ids', () => {
  assert.equal(roomFor('request', 'r1'), 'request:r1');
  assert.equal(roomFor('user', 'u1'), 'user:u1');
  assert.equal(roomFor('request', null), null);
  assert.equal(roomFor('request', ''), null);
});

test('eventsUrl encodes the room and omits it when absent', () => {
  assert.equal(eventsUrl('collection:c 1'), '/api/events?room=collection%3Ac%201');
  assert.equal(eventsUrl(null), '/api/events');
});

test('parseSseFrame extracts the JSON data line', () => {
  const frame = 'event: message\ndata: {"type":"presence","viewers":[]}';
  assert.deepEqual(parseSseFrame(frame), { type: 'presence', viewers: [] });
  assert.equal(parseSseFrame('event: ping'), null);
  assert.equal(parseSseFrame('data: not-json'), null);
  // EventSource.onmessage receives the bare payload with the prefix stripped.
  assert.deepEqual(parseSseFrame('{"type":"notification","notification":{"id":"n1"}}'), {
    type: 'notification',
    notification: { id: 'n1' },
  });
  assert.equal(parseSseFrame(''), null);
});

test('viewerSummary excludes self and labels the count', () => {
  const viewers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(viewerSummary(viewers, 'a'), { count: 2, label: '2 others viewing' });
  assert.deepEqual(viewerSummary([{ id: 'a' }], 'a'), { count: 0, label: 'You are the only one here' });
  assert.deepEqual(viewerSummary([{ id: 'a' }, { id: 'b' }], 'a'), { count: 1, label: '1 other viewing' });
  assert.deepEqual(viewerSummary(null, 'a'), { count: 0, label: '' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test src/lib/__tests__/realtime.test.cjs`
Expected: FAIL — cannot find module `../realtime.js`.

- [ ] **Step 3: Implement the helpers**

Create `frontend/src/lib/realtime.js`:

```js
'use strict';

function roomFor(kind, id) {
  if (!kind || !id) return null;
  return `${kind}:${id}`;
}

function eventsUrl(room) {
  return room ? `/api/events?room=${encodeURIComponent(room)}` : '/api/events';
}

function parseSseFrame(frame) {
  const raw = String(frame || '').trim();
  if (!raw) return null;
  // Accept either a raw frame block (`event: message` / `data: {...}`) or a
  // bare payload (EventSource strips the `data:` prefix before onmessage).
  const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
  const payload = dataLine ? dataLine.slice(5).trim() : raw;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function viewerSummary(viewers, selfId) {
  if (!Array.isArray(viewers)) return { count: 0, label: '' };
  const others = viewers.filter((v) => v && v.id && v.id !== selfId).length;
  if (others === 0) return { count: 0, label: 'You are the only one here' };
  if (others === 1) return { count: 1, label: '1 other viewing' };
  return { count: others, label: `${others} others viewing` };
}

module.exports = { roomFor, eventsUrl, parseSseFrame, viewerSummary };
```

- [ ] **Step 4: Implement the hook**

Create `frontend/src/components/useRoomEvents.ts`:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { eventsUrl, parseSseFrame } from '@/lib/realtime';

export interface RealtimeViewer {
  id: string;
  name: string | null;
}

export function useRoomEvents(
  room: string | null,
  onEvent?: (event: Record<string, unknown>) => void
): { connected: boolean; viewers: RealtimeViewer[] } {
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState<RealtimeViewer[]>([]);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!room || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setConnected(false);
      setViewers([]);
      return;
    }
    const source = new EventSource(eventsUrl(room));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      const event = parseSseFrame(message.data);
      if (!event) return;
      if (event.type === 'presence' && Array.isArray((event as { viewers?: unknown }).viewers)) {
        setViewers((event as { viewers: RealtimeViewer[] }).viewers);
      }
      handlerRef.current?.(event as Record<string, unknown>);
    };
    return () => {
      source.close();
      setConnected(false);
      setViewers([]);
    };
  }, [room]);

  return { connected, viewers };
}
```

Note: `EventSource.onmessage` receives `MessageEvent` whose `data` is the `data:` line payload (the server sends `event: message`, which maps to `onmessage`). `parseSseFrame(message.data)` handles a bare payload (no `event:` line needed).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && node --test src/lib/__tests__/realtime.test.cjs && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/realtime.js frontend/src/lib/__tests__/realtime.test.cjs frontend/src/components/useRoomEvents.ts
git commit -m "feat(realtime): frontend SSE client helpers and useRoomEvents hook"
```

---

## Task 7: Live notification bell + live collab panel

**Files:**
- Modify: `frontend/src/components/TopBar.tsx` (`NotificationBell`, around `:37-134`)
- Modify: `frontend/src/components/collab/CollabPanel.tsx` (comments + review sections)
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `useRoomEvents` (Task 6); `roomFor`; existing `notificationApi.list`, `collabApi`.
- Produces: the bell prepends live notifications; `/collab` reloads comments/reviews on entity events and renders a presence roster.

- [ ] **Step 1: Bell consumes the user room**

In `TopBar.tsx`, import `useRoomEvents` and `roomFor`. The bell is the `NotificationBell` component, which already calls `useAuth()` for `user`, keeps `notifications`/`setNotifications` (type `Notification[]`) and `unread`/`setUnread`, and polls every 30 s. Inside `NotificationBell`, add:

```tsx
useRoomEvents(roomFor('user', user?.id), (event) => {
  const notification = (event as { notification?: Notification }).notification;
  if (event.type === 'notification' && notification) {
    setNotifications((prev) => [notification, ...prev].slice(0, 50));
    setUnread((prev) => (notification.read ? prev : prev + 1));
  }
});
```

Keep the existing 30 s `setInterval(load, 30000)` poll in place as a reconciliation fallback (do not remove it). Do not render `viewers` for the user room.

- [ ] **Step 2: Collab panel reloads on entity events**

`CollabPanel.tsx` splits into `CommentsSection` (owns `load()`, receives `targetType`/`targetId`) and `ReviewSection` (owns `load()`, receives `collectionId`). Put each subscription where its loader lives — do not add duplicate fetch logic, and do not wire `load()` from the top-level `CollabPanel` (it does not own those functions).

In `CommentsSection`, add `useAuth` (from `@/lib/auth`), `useRoomEvents`/`roomFor`/`viewerSummary` (from `@/lib/realtime`), then:

```tsx
const { user } = useAuth();
const { viewers } = useRoomEvents(roomFor(targetType, targetId), (event) => {
  if (String(event.type || '').startsWith('comment:')) void load();
});
```

Render presence in the comments section header (only when the label is non-empty):

```tsx
{viewerSummary(viewers, user?.id).label && (
  <span className="presence" data-testid="presence-count">{viewerSummary(viewers, user?.id).label}</span>
)}
```

In `ReviewSection`, subscribe to the collection room and reload on review events:

```tsx
useRoomEvents(roomFor('collection', collectionId), (event) => {
  if (String(event.type || '').startsWith('review:')) void load();
});
```

Do NOT render a second presence label in `ReviewSection`: when `targetType === 'collection'` it shares the same `collection:<id>` room as the comments section, so the single `presence-count` label already reflects all viewers.

- [ ] **Step 3: Styles**

Append to `globals.css`:

```css
.presence {
  font-size: 12px;
  color: var(--text-muted, #94a3b8);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.conflict-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--warning-border, #a16207);
  background: var(--warning-bg, rgba(161, 98, 7, 0.12));
  border-radius: 8px;
  font-size: 13px;
}
```

(Match existing CSS-variable naming in `globals.css`; if `--warning-border`/`--warning-bg`/`--text-muted` do not exist, use the nearest existing tokens rather than inventing new ones.)

- [ ] **Step 4: Typecheck + unit tests**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: clean; existing 112 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TopBar.tsx frontend/src/components/collab/CollabPanel.tsx frontend/app/globals.css
git commit -m "feat(realtime): live notification bell and collab panel presence"
```

---

## Task 8: Presence + concurrent-edit warning in request and doc editors

**Files:**
- Modify: `frontend/src/components/RequestConfigurator.tsx`
- Modify: `frontend/src/store/WorkspaceStore.tsx` (add `reloadActiveRequest`)
- Modify: `frontend/src/components/docs/DocsPageView.tsx`
- Modify: `frontend/app/globals.css` (if more styles are needed)

**Interfaces:**
- Consumes: `useRoomEvents`, `roomFor`, `viewerSummary` (Task 6).
- Produces: a presence line and a conflict banner with `data-testid="request-conflict-banner"` / `data-testid="doc-conflict-banner"` and a reload action.

- [ ] **Step 1: Request editor presence + conflict banner**

In `RequestConfigurator.tsx`, the active request id and dirty state come from `useWorkspace()` (`ws.activeRequestId`, `ws.isDirty`/the existing dirty signal; verify the exact accessor in `WorkspaceStore.tsx:602-608`). Add:

```tsx
const { viewers } = useRoomEvents(
  roomFor('request', ws.activeRequestId),
  (event) => {
    if (event.type === 'entity:updated' && (event.by as { id?: string } | undefined)?.id !== user?.id) {
      setRemoteUpdate(true);
    }
  }
);
```

Where `user` comes from `useAuth()`. Add state and, when `remoteUpdate && dirty`, render above the editor:

```tsx
{remoteUpdate && dirty && (
  <div className="conflict-banner" data-testid="request-conflict-banner">
    <span>{viewerSummary(viewers, user?.id).count > 0 ? `${viewerSummary(viewers, user?.id).label}. ` : ''}This request changed elsewhere.</span>
    <button type="button" className="ghost-button small" onClick={() => { setRemoteUpdate(false); ws.selectRequest(ws.activeRequestId!); }}>
      Reload
    </button>
  </div>
)}
```

Reload must discard the unsaved working copy and re-read the saved request. `selectRequest(activeRequestId)` does **not** do this: when the request is already an open tab it restores the cached working copy (with the user's edits) without refetching. No discard/reload action exists, so add one to `WorkspaceStore.tsx`:

```ts
// Value interface
reloadActiveRequest: () => Promise<void>;

// Implementation (next to selectRequest), mirroring its guard patterns:
const reloadActiveRequest = useCallback(async () => {
  const id = activeRequestId;
  if (!id) return;
  const seq = ++selectSeqRef.current;
  selectTargetRef.current = id;
  try {
    const { request } = await contentApi.getRequest(id);
    if (selectSeqRef.current !== seq || selectTargetRef.current !== id) return;
    const editorRequest = toEditorRequest(request);
    setRequestCopies((c) => ({ ...c, [id]: editorRequest }));
    setBaselines((b) => ({ ...b, [id]: dirtySnapshot(editorRequest) }));
    setActiveRequest(editorRequest);
    clearEditHistory(id);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to reload request');
  }
}, [activeRequestId]);
```

Add `reloadActiveRequest` to the store's returned `value` object (and its `useMemo` deps). Reuse the existing `contentApi`, `toEditorRequest`, `dirtySnapshot`, `clearEditHistory`, `selectSeqRef`, `selectTargetRef`, and `setError` already in scope from `selectRequest`. Then the Reload button calls `ws.reloadActiveRequest()`.

Place the `useRoomEvents` call **before** `RequestConfigurator`'s early return (`if (!request) return ...`, around line 84) so hook order is stable. Reset `remoteUpdate` when `ws.activeRequestId` changes.

- [ ] **Step 2: Docs editor presence + conflict banner**

In `DocsPageView.tsx`, the active page id is known from the component's props/`?p=`. Add the same pattern with `roomFor('doc', pageId)`, `useAuth()`, and the existing `dirty` memo (`:76-81`). Render:

```tsx
{remoteUpdate && dirty && (
  <div className="conflict-banner" data-testid="doc-conflict-banner">
    <span>This page changed elsewhere.</span>
    <button type="button" className="ghost-button small" onClick={() => { setRemoteUpdate(false); load(); }}>
      Reload
    </button>
  </div>
)}
```

Use the component's existing `load()` (which replaces the draft) for Reload.

- [ ] **Step 3: Presence line**

In both editors, render the presence label near the entity title (only when non-empty):

```tsx
{viewerSummary(viewers, user?.id).label && (
  <span className="presence" data-testid="editor-presence">{viewerSummary(viewers, user?.id).label}</span>
)}
```

- [ ] **Step 4: Typecheck + unit tests**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: clean; 112+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RequestConfigurator.tsx frontend/src/components/docs/DocsPageView.tsx frontend/app/globals.css
git commit -m "feat(realtime): entity presence and concurrent-edit warning"
```

---

## Task 9: Docs + session log

**Files:**
- Modify: `docs/FEATURES.md`
- Modify: `session_v2.md`

- [ ] **Step 1: Update `docs/FEATURES.md`**

Add a `## 24. Realtime collaboration` section at the end (after the Testing section), covering: the `GET /api/events` SSE endpoint and room model (`user|request|collection|doc:<uuid>`), cookie auth + room authorization via `canReadProject`/`canReadPage`, the in-process hub (and the single-process assumption / Redis-pubsub note for a future split), what streams today (notifications, comment/review events, entity-updated conflict signals), presence, the concurrent-edit warning behavior, and the explicit v1 limitation (no character-level co-editing; presence is ephemeral and lost on restart). If a numbering conflict arises, renumber only as needed and check for in-document references.

Also add a `### Events` block to the §20 Endpoint reference:

```
GET    /api/events?room=<kind>:<uuid>     (text/event-stream)
```

- [ ] **Step 2: Append to `session_v2.md`**

Add a `### Realtime collaboration (details)` subsection in the existing style: hub module, SSE route + rooms/auth, notification streaming + shared notifier refactor, comment/review events, entity-updated events, FE `useRoomEvents`/helpers, live bell, collab presence, editor conflict banner, tests (`backend/src/api/__tests__/realtime.test.cjs`, `backend/src/api/__tests__/notifyRealtime.test.cjs`, `backend/tests/realtime.integration.test.cjs`, `frontend/src/lib/__tests__/realtime.test.cjs`), and the v1 limitations.

- [ ] **Step 3: Commit**

```bash
git add docs/FEATURES.md session_v2.md
git commit -m "docs: record realtime collaboration"
```

(Push is handled by the controller after the whole-branch review.)

---

## Self-Review

- **Spec coverage:** SSE transport (T2), in-process bus (T1), notification streaming (T3), comment/review live updates (T4), entity-updated conflict signal (T5), FE client (T6), live bell + collab presence (T7), editor presence + conflict warning (T8), docs (T9). Character-level co-editing is explicitly excluded. ✅
- **Placeholder scan:** No TBDs. Tasks 7 and 8 reference exact files and integration anchors rather than full component rewrites because those components are large; they specify the exact subscription calls, state, JSX, testids, and CSS classes to add. ✅
- **Type consistency:** `roomKey`/`roomFor` both produce `<kind>:<id>`; `realtime.roomKey` (backend) and `roomFor` (frontend) agree. Event type strings (`presence`, `notification`, `comment:created|resolved|unresolved|deleted`, `review:created|decided`, `entity:updated`) are identical across backend publishers, integration tests, and FE handlers. `viewersFor` (backend) and `RealtimeViewer` (frontend) agree on `{ id, name }`. ✅
- **Risk note for the controller:** SSE through the Next dev rewrite should stream, but Task 2's implementer should confirm with a quick manual check (`curl -N http://127.0.0.1:3000/api/events` while a comment is posted) once the endpoint exists; if the rewrite buffers, the fallback is to consume the backend directly for local development and rely on the built-in preview proxy, or add a Next custom server — escalate before deviating.
