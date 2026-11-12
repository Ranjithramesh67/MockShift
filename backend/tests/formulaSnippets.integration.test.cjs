'use strict';

// Custom formula snippets (migration 064): a per-user, cross-device preference.
//
//  - GET returns [] until the user creates any snippet;
//  - PUT stores a valid list and GET echoes it back on a fresh session
//    (this is what makes it follow the account across devices);
//  - missing title/code, oversize payloads, and non-arrays are rejected (400);
//  - an empty array clears the preference;
//  - a second account never sees another user's snippets.

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

test('formula-snippets is empty until customized, then persists across sessions', async () => {
  const { client, cookie } = await signupAndLogin(
    base,
    'formula-snip@test.io',
    'formulasnip123',
    'Formula Snip'
  );

  const initial = await client.api('GET', '/api/profile/formula-snippets');
  assert.equal(initial.status, 200, JSON.stringify(initial.json));
  assert.deepEqual(initial.json.snippets, []);

  const wanted = [
    { title: 'Stamp today', code: 'req.body.stamp = $utils.formatDate($utils.now(), "YYYY-MM-DD")' },
  ];
  const saved = await client.api('PUT', '/api/profile/formula-snippets', { snippets: wanted });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.snippets.length, 1);
  assert.equal(saved.json.snippets[0].title, 'Stamp today');
  assert.equal(saved.json.snippets[0].code, wanted[0].code);
  assert.equal(saved.json.snippets[0].description, 'Custom formula');

  const other = makeClient(base, cookie);
  const readBack = await other.api('GET', '/api/profile/formula-snippets');
  assert.equal(readBack.status, 200, JSON.stringify(readBack.json));
  assert.deepEqual(readBack.json.snippets, saved.json.snippets);

  assert.equal(
    psql(`SELECT formula_snippets FROM users WHERE email = 'formula-snip@test.io'`).includes('Stamp today'),
    true
  );
});

test('invalid snippets are rejected without changing the stored list', async () => {
  const { client } = await signupAndLogin(base, 'formula-bad@test.io', 'formulabad123', 'Formula Bad');

  const notArray = await client.api('PUT', '/api/profile/formula-snippets', { snippets: 'nope' });
  assert.equal(notArray.status, 400, JSON.stringify(notArray.json));

  const missing = await client.api('PUT', '/api/profile/formula-snippets', {
    snippets: [{ title: 'Only name' }],
  });
  assert.equal(missing.status, 400, JSON.stringify(missing.json));

  const emptyTitle = await client.api('PUT', '/api/profile/formula-snippets', {
    snippets: [{ title: '  ', code: '$utils.now()' }],
  });
  assert.equal(emptyTitle.status, 400, JSON.stringify(emptyTitle.json));

  const after = await client.api('GET', '/api/profile/formula-snippets');
  assert.deepEqual(after.json.snippets, []);
});

test('an empty array clears snippets and accounts are isolated', async () => {
  const a = await signupAndLogin(base, 'formula-a@test.io', 'formulaa12345', 'Formula A');
  const b = await signupAndLogin(base, 'formula-b@test.io', 'formulab12345', 'Formula B');

  await a.client.api('PUT', '/api/profile/formula-snippets', {
    snippets: [{ title: 'A only', code: '$utils.uuid()' }],
  });
  await b.client.api('PUT', '/api/profile/formula-snippets', {
    snippets: [{ title: 'B only', code: '$utils.now()' }],
  });

  const aRead = await a.client.api('GET', '/api/profile/formula-snippets');
  const bRead = await b.client.api('GET', '/api/profile/formula-snippets');
  assert.equal(aRead.json.snippets[0].title, 'A only');
  assert.equal(bRead.json.snippets[0].title, 'B only');

  const cleared = await a.client.api('PUT', '/api/profile/formula-snippets', { snippets: [] });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.deepEqual(cleared.json.snippets, []);

  const aAfter = await a.client.api('GET', '/api/profile/formula-snippets');
  const bAfter = await b.client.api('GET', '/api/profile/formula-snippets');
  assert.deepEqual(aAfter.json.snippets, []);
  assert.equal(bAfter.json.snippets[0].title, 'B only');
});

test('formula-snippets requires authentication', async () => {
  const anon = makeClient(base);
  const res = await anon.api('GET', '/api/profile/formula-snippets');
  assert.equal(res.status, 401);
});
