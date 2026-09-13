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

// forgot-password responds before the mail is sent (so its timing cannot leak
// account existence), so wait for the detached send to land.
async function waitForResetToken(address, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = [...sent].reverse().find((m) => m.to === address && m.subject.includes('Reset'));
    if (message) {
      const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(message.text);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`reset email not sent to ${address}`);
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

  const token = await waitForResetToken('reset-me@example.com');
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
  const token = await waitForResetToken('reset-once@example.com');

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
  const token = await waitForResetToken('reset-session@example.com');

  const resetter = makeClient(app.base);
  assert.equal(
    (await resetter.api('POST', '/api/auth/reset-password', { token, new_password: 'newpassword2' })).status,
    200
  );

  assert.equal((await client.api('GET', '/api/auth/me')).status, 401);
  assert.equal((await client.api('GET', '/api/auth/session')).json.authenticated, false);

  // The stored-request run route rolls its own session auth — a reset must
  // invalidate the old session there too, not just on the requireAuth routes.
  assert.equal(
    (await client.api('POST', '/api/runs', { requestId: '00000000-0000-0000-0000-000000000000' })).status,
    401
  );

  const freshLogin = makeClient(app.base);
  assert.equal(
    (await freshLogin.api('POST', '/api/auth/login', { email: 'reset-session@example.com', password: 'newpassword2' })).status,
    200
  );
});

test('changing the password invalidates other sessions and refreshes the actor', async () => {
  const actor = makeClient(app.base);
  await actor.api('POST', '/api/auth/signup', {
    email: 'change-pw@example.com',
    password: 'oldpassword1',
  });

  const other = makeClient(app.base);
  assert.equal(
    (await other.api('POST', '/api/auth/login', { email: 'change-pw@example.com', password: 'oldpassword1' })).status,
    200
  );
  assert.equal((await other.api('GET', '/api/auth/me')).status, 200);

  assert.equal(
    (await actor.api('POST', '/api/profile/password', {
      current_password: 'oldpassword1',
      new_password: 'newpassword2',
    })).status,
    200
  );

  // The acting session is re-issued a fresh cookie and keeps working...
  assert.equal((await actor.api('GET', '/api/auth/me')).status, 200);
  // ...while the other session is revoked, including on the run route.
  assert.equal((await other.api('GET', '/api/auth/me')).status, 401);
  assert.equal(
    (await other.api('POST', '/api/runs', { requestId: '00000000-0000-0000-0000-000000000000' })).status,
    401
  );
});
