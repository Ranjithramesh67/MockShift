'use strict';

// Sidebar rail order (migration 056): a per-user, cross-device preference.
//
//  - GET returns `null` until the user customizes anything;
//  - PUT stores a valid permutation and GET echoes it back on a fresh session
//    (this is what makes it follow the account across devices);
//  - unknown / duplicate keys are rejected (400) rather than silently stored;
//  - an empty array clears the preference back to the default;
//  - keys persisted by an older build that later became unknown are filtered
//    out on read instead of breaking the client.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
});

after(async () => {
  if (closeApp) await closeApp();
});

test('nav-order is null until customized, then persists across sessions', async () => {
  const { client, cookie } = await signupAndLogin(base, 'nav-order@test.io', 'navorder123', 'Nav Order');

  const initial = await client.api('GET', '/api/profile/nav-order');
  assert.equal(initial.status, 200, JSON.stringify(initial.json));
  assert.equal(initial.json.order, null);
  assert.ok(Array.isArray(initial.json.keys) && initial.json.keys.includes('apis'));

  const wanted = ['docs', 'apis', 'workflow', 'admin'];
  const saved = await client.api('PUT', '/api/profile/nav-order', { order: wanted });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.order, wanted);

  // A brand-new session for the same account sees the saved order.
  const other = makeClient(base, cookie);
  const readBack = await other.api('GET', '/api/profile/nav-order');
  assert.equal(readBack.status, 200, JSON.stringify(readBack.json));
  assert.deepEqual(readBack.json.order, wanted);

  // It is stored on the user row itself (not a separate table).
  assert.equal(
    psql(`SELECT nav_rail_order FROM users WHERE email = 'nav-order@test.io'`).includes('docs'),
    true
  );
});

test('unknown and duplicate keys are rejected without changing the stored order', async () => {
  const { client } = await signupAndLogin(base, 'nav-invalid@test.io', 'navinvalid123', 'Nav Invalid');

  const unknown = await client.api('PUT', '/api/profile/nav-order', { order: ['apis', 'bogus'] });
  assert.equal(unknown.status, 400, JSON.stringify(unknown.json));
  assert.match(unknown.json.error, /bogus/);

  const dup = await client.api('PUT', '/api/profile/nav-order', { order: ['apis', 'apis'] });
  assert.equal(dup.status, 400, JSON.stringify(dup.json));
  assert.match(dup.json.error, /Duplicate/);

  const notArray = await client.api('PUT', '/api/profile/nav-order', { order: 'apis' });
  assert.equal(notArray.status, 400, JSON.stringify(notArray.json));

  // Nothing was written by the failed attempts.
  const after = await client.api('GET', '/api/profile/nav-order');
  assert.equal(after.json.order, null);
});

test('an empty array clears the preference and stale keys are filtered on read', async () => {
  const { client } = await signupAndLogin(base, 'nav-clear@test.io', 'navclear123', 'Nav Clear');

  await client.api('PUT', '/api/profile/nav-order', { order: ['teams', 'apis'] });
  const cleared = await client.api('PUT', '/api/profile/nav-order', { order: [] });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal(cleared.json.order, null);

  const read = await client.api('GET', '/api/profile/nav-order');
  assert.equal(read.json.order, null);

  // Simulate a key that used to be valid being persisted, then read: the unknown
  // key is dropped but the known ones survive.
  psql(`UPDATE users SET nav_rail_order = '["legacy-key","docs","apis"]'::jsonb WHERE email = 'nav-clear@test.io'`);
  const filtered = await client.api('GET', '/api/profile/nav-order');
  assert.deepEqual(filtered.json.order, ['docs', 'apis']);
});

test('nav-order requires authentication', async () => {
  const anon = makeClient(base);
  const res = await anon.api('GET', '/api/profile/nav-order');
  assert.equal(res.status, 401);
});
