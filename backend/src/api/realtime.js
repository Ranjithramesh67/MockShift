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
