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
//
// Room access is authorized at connect time and re-checked on an interval, so a
// stream cannot outlive a permission change (member removed, role downgraded,
// share revoked): the connection is closed with an `error` frame once the
// caller no longer has access. Tune with REALTIME_AUTH_RECHECK_MS.
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

function authRecheckMs() {
  const n = Number(process.env.REALTIME_AUTH_RECHECK_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
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

    // Register cleanup before the first await so a client that disconnects
    // during room authorization cannot leak a subscriber or heartbeat timer.
    let unsubscribe = null;
    let timer = null;
    let authTimer = null;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (authTimer) {
        clearInterval(authTimer);
        authTimer = null;
      }
      if (unsubscribe) {
        unsubscribe();
        realtime.publish(room, { type: 'presence', room, viewers: realtime.viewersFor(room) });
      }
    };
    res.on('close', cleanup);
    req.on('close', cleanup);

    const auth = await authorizeRoom(req.user, room);
    if (!auth.ok) {
      cleanup();
      return res.status(auth.status).json({ error: auth.error });
    }
    if (req.destroyed || res.writableEnded) {
      cleanup();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const send = (event) => {
      if (res.writableEnded || req.destroyed) return;
      res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
    };

    unsubscribe = realtime.subscribe(room, { userId: req.user.id, name: req.user.name, send });
    realtime.publish(room, { type: 'presence', room, viewers: realtime.viewersFor(room) });

    timer = setInterval(() => {
      if (!res.writableEnded && !req.destroyed) res.write(': ping\n\n');
    }, heartbeatMs());

    // Periodically re-authorize the room so a revoked permission tears the
    // stream down instead of leaking events for the connection's lifetime.
    let rechecking = false;
    authTimer = setInterval(async () => {
      if (done || rechecking) return;
      rechecking = true;
      try {
        const recheck = await authorizeRoom(req.user, room);
        if (!recheck.ok) {
          if (!res.writableEnded && !req.destroyed) {
            res.write(
              `event: error\ndata: ${JSON.stringify({
                type: 'unauthorized',
                status: recheck.status,
                error: recheck.error,
              })}\n\n`
            );
            res.end();
          }
          cleanup();
        }
      } catch (err) {
        // A transient failure must not kill a still-authorized stream.
        console.error('[events] room re-check failed:', err.message);
      } finally {
        rechecking = false;
      }
    }, authRecheckMs());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.authorizeRoom = authorizeRoom;
