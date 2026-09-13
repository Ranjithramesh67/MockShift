'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient } = require('./support/harness.cjs');
const email = require('../src/api/email');

let app;
const sent = [];

before(async () => {
  email.setTransportForTest({
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: `test-${sent.length}` };
    },
  });
  app = await startApp();
});

after(async () => {
  email.resetTransportForTest();
  await app.close();
});

function resetTokenFor(address) {
  const message = [...sent].reverse().find((m) => m.to === address && m.subject.includes('Reset'));
  assert.ok(message, `reset email sent to ${address}`);
  const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(match, `token link not found in: ${message.text}`);
  return match[1];
}

test('forgot-password does not reveal whether an account exists', async () => {
  const client = makeClient(app.base);
  const missing = await client.api('POST', '/api/auth/forgot-password', { email: 'nobody@example.com' });
  assert.equal(missing.status, 200);
  assert.equal(missing.json.ok, true);
  assert.equal(sent.length, 0);
});

test('reset-password sets a new password usable for login', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'reset-me@example.com',
    password: 'oldpassword1',
  });

  const forgot = await client.api('POST', '/api/auth/forgot-password', {
    email: 'reset-me@example.com',
  });
  assert.equal(forgot.status, 200);

  const token = resetTokenFor('reset-me@example.com');
  const reset = await client.api('POST', '/api/auth/reset-password', {
    token,
    new_password: 'newpassword2',
  });
  assert.equal(reset.status, 200);

  const badLogin = makeClient(app.base);
  assert.equal(
    (await badLogin.api('POST', '/api/auth/login', { email: 'reset-me@example.com', password: 'oldpassword1' })).status,
    401
  );
  const goodLogin = makeClient(app.base);
  assert.equal(
    (await goodLogin.api('POST', '/api/auth/login', { email: 'reset-me@example.com', password: 'newpassword2' })).status,
    200
  );
});

test('reset tokens are single-use and short-password is rejected', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'reset-once@example.com',
    password: 'oldpassword1',
  });
  await client.api('POST', '/api/auth/forgot-password', { email: 'reset-once@example.com' });
  const token = resetTokenFor('reset-once@example.com');

  assert.equal(
    (await client.api('POST', '/api/auth/reset-password', { token, new_password: 'short' })).status,
    400
  );
  assert.equal(
    (await client.api('POST', '/api/auth/reset-password', { token, new_password: 'newpassword2' })).status,
    200
  );
  assert.equal(
    (await client.api('POST', '/api/auth/reset-password', { token, new_password: 'anotherpass3' })).status,
    400
  );
});

test('a password reset invalidates sessions issued before it', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'reset-session@example.com',
    password: 'oldpassword1',
  });
  assert.equal((await client.api('GET', '/api/auth/me')).status, 200);

  await client.api('POST', '/api/auth/forgot-password', { email: 'reset-session@example.com' });
  const token = resetTokenFor('reset-session@example.com');

  const resetter = makeClient(app.base);
  assert.equal(
    (await resetter.api('POST', '/api/auth/reset-password', { token, new_password: 'newpassword2' })).status,
    200
  );

  assert.equal((await client.api('GET', '/api/auth/me')).status, 401);
  assert.equal((await client.api('GET', '/api/auth/session')).json.authenticated, false);

  const freshLogin = makeClient(app.base);
  assert.equal(
    (await freshLogin.api('POST', '/api/auth/login', { email: 'reset-session@example.com', password: 'newpassword2' })).status,
    200
  );
});
