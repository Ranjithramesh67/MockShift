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
