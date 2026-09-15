'use strict';

// LOW-3 — email is a case-insensitive identity: a case-variant of an existing
// address must not create a second account, and login must accept any casing.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, psql } = require('./support/harness.cjs');

let app;

before(async () => {
  app = await startApp();
});

after(async () => {
  if (app) await app.close();
});

function scalar(sql) {
  const match = psql(sql).match(/^\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}

test('case-variant emails resolve to a single account', async () => {
  const first = await makeClient(app.base).api('POST', '/api/auth/signup', {
    email: 'MixedCase@test.io',
    password: 'mixedcase123',
    name: 'Mixed Case',
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.user.user ? first.json.user.user.email : first.json.user.email, 'mixedcase@test.io');

  const duplicate = await makeClient(app.base).api('POST', '/api/auth/signup', {
    email: 'mixedcase@TEST.io',
    password: 'mixedcase123',
    name: 'Mixed Case Two',
  });
  assert.equal(duplicate.status, 409, 'case-variant signup must conflict');

  const login = await makeClient(app.base).api('POST', '/api/auth/login', {
    email: 'MIXEDCASE@TEST.IO',
    password: 'mixedcase123',
  });
  assert.equal(login.status, 200, 'login must be case-insensitive');

  assert.equal(scalar(`SELECT count(*) FROM users WHERE lower(email) = 'mixedcase@test.io'`), 1);
  assert.equal(scalar(`SELECT count(*) FROM users WHERE email = lower(email)`), scalar('SELECT count(*) FROM users'));
});
