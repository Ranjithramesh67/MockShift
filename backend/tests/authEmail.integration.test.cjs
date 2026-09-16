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

function tokenFrom(message, path) {
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(message.text || '');
  assert.ok(match, `token link not found in: ${message.text}`);
  return match[1];
}

test('signup sends a verification email and verify-email flips the flag', async () => {
  const client = makeClient(app.base);
  const signup = await client.api('POST', '/api/auth/signup', {
    email: 'verify-me@example.com',
    password: 'password123',
    name: 'Verify Me',
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.json.user.user.email_verified, false);

  const message = sent.find((m) => m.to === 'verify-me@example.com');
  assert.ok(message, 'verification email was sent');
  const token = tokenFrom(message, '/verify-email');

  const verified = await client.api('POST', '/api/auth/verify-email', { token });
  assert.equal(verified.status, 200);
  assert.equal(verified.json.ok, true);

  const me = await client.api('GET', '/api/auth/me');
  assert.equal(me.json.user.email_verified, true);
});

test('verify-email rejects an unknown or reused token', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'verify-twice@example.com',
    password: 'password123',
  });
  const message = sent.find((m) => m.to === 'verify-twice@example.com');
  const token = tokenFrom(message, '/verify-email');

  assert.equal((await client.api('POST', '/api/auth/verify-email', { token })).status, 200);
  assert.equal((await client.api('POST', '/api/auth/verify-email', { token })).status, 400);
  assert.equal((await client.api('POST', '/api/auth/verify-email', { token: 'nope' })).status, 400);
});

test('resend-verification fails loudly when SMTP is not configured', async () => {
  // A server with no SMTP previously answered 200 while the mailer silently
  // skipped, so the "Resend email" button reported success and the user waited
  // for a message that was never sent.
  const savedEnv = {
    SMTP_URL: process.env.SMTP_URL,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
  };
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  email.resetTransportForTest();
  try {
    const client = makeClient(app.base);
    const signup = await client.api('POST', '/api/auth/signup', {
      email: 'no-smtp-resend@example.com',
      password: 'password123',
    });
    assert.equal(signup.status, 201);
    assert.equal(signup.json.emailVerification, 'not_configured');

    const res = await client.api('POST', '/api/auth/resend-verification', {});
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'smtp_not_configured');
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    email.setTransportForTest({
      sendMail: async (msg) => {
        sent.push(msg);
        return { messageId: `test-${sent.length}` };
      },
    });
  }
});

test('resend-verification is a no-op for a verified user', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'resend-me@example.com',
    password: 'password123',
  });
  const token = tokenFrom(sent.find((m) => m.to === 'resend-me@example.com'), '/verify-email');
  await client.api('POST', '/api/auth/verify-email', { token });

  const before = sent.length;
  const res = await client.api('POST', '/api/auth/resend-verification', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.alreadyVerified, true);
  assert.equal(sent.length, before);
});
