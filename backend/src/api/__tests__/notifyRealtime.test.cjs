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
