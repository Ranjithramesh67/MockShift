'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  createSessionToken,
  sessionCookie,
  clearSessionCookie,
  sessionCookieHeaders,
  clearSessionCookieHeaders,
  cookieDomain,
  verifySession: verify,
} = require('../authLib');

test('password hashing round-trips', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('hashes are salted (same password, different hashes)', async () => {
  const a = await hashPassword('pw');
  const b = await hashPassword('pw');
  assert.notEqual(a, b);
});

test('session tokens are signed and expiring', () => {
  const token = createSessionToken('user-123');
  const payload = verifySession(token);
  assert.ok(payload);
  assert.equal(payload.userId, 'user-123');
  assert.ok(payload.exp > Date.now());
});

test('tampered session tokens are rejected', () => {
  const token = createSessionToken('user-123');
  const dot = token.indexOf('.');
  const forged = `${'user-999'}${token.slice(dot)}`;
  assert.equal(verify(forged), null);
  assert.equal(verify('garbage.token'), null);
  assert.equal(verify(''), null);
  assert.equal(verify(null), null);
});

test('expired session tokens are rejected', () => {
  const token = signSession({ userId: 'u1', exp: Date.now() - 1000 });
  assert.equal(verifySession(token), null);
});

test('session cookie sets Secure only for TLS deployments', () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    FORCE_SECURE_COOKIES: process.env.FORCE_SECURE_COOKIES,
  };
  try {
    delete process.env.NODE_ENV;
    delete process.env.COOKIE_SECURE;
    delete process.env.FORCE_SECURE_COOKIES;
    const insecure = sessionCookie('tok');
    assert.match(insecure, /HttpOnly/);
    assert.match(insecure, /SameSite=Lax/);
    assert.doesNotMatch(insecure, /Secure/);
    assert.doesNotMatch(clearSessionCookie(), /Secure/);

    process.env.FORCE_SECURE_COOKIES = '1';
    assert.match(sessionCookie('tok'), /; Secure/);
    assert.match(clearSessionCookie(), /; Secure/);

    delete process.env.FORCE_SECURE_COOKIES;
    process.env.NODE_ENV = 'production';
    assert.match(sessionCookie('tok'), /; Secure/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('session cookie shares a parent domain across sibling apps', () => {
  const previous = process.env.COOKIE_DOMAIN;
  try {
    delete process.env.COOKIE_DOMAIN;
    // Production host without an explicit domain stays host-only (safe default).
    assert.equal(cookieDomain({ headers: { host: 'mockshift.example.com' } }), null);
    assert.doesNotMatch(sessionCookie('tok', { headers: { host: 'mockshift.example.com' } }), /Domain=/);

    // Preview sibling hosts derive the session-scoped parent so both ports share it.
    const previewReq = { headers: { host: '3000-ab12.monkeycode-ai.live' } };
    assert.equal(cookieDomain(previewReq), '.ab12.monkeycode-ai.live');
    assert.match(sessionCookie('tok', previewReq), /; Domain=\.ab12\.monkeycode-ai\.live/);
    assert.match(clearSessionCookie(previewReq), /; Domain=\.ab12\.monkeycode-ai\.live/);
    // The sibling portal host (different port, same session) resolves to the same domain.
    assert.equal(
      cookieDomain({ headers: { host: '3002-ab12.monkeycode-ai.live' } }),
      '.ab12.monkeycode-ai.live'
    );

    // An explicit COOKIE_DOMAIN always wins and gets a leading dot.
    process.env.COOKIE_DOMAIN = 'app.example.com';
    assert.match(sessionCookie('tok', previewReq), /; Domain=\.app\.example\.com/);
    assert.match(clearSessionCookie(previewReq), /; Domain=\.app\.example\.com/);

    // x-forwarded-host is honoured when present (reverse-proxy deployments).
    delete process.env.COOKIE_DOMAIN;
    assert.equal(
      cookieDomain({ headers: { 'x-forwarded-host': '3000-cd34.monkeycode-ai.live:443', host: '127.0.0.1:3001' } }),
      '.cd34.monkeycode-ai.live'
    );

    // Setting a domain cookie also expires the legacy host-only one so a single
    // session cookie remains; clearing does both for the same reason.
    const shared = sessionCookieHeaders('tok', previewReq);
    assert.ok(Array.isArray(shared));
    assert.equal(shared.length, 2);
    assert.match(shared[0], /; Domain=\.ab12\.monkeycode-ai\.live/);
    assert.doesNotMatch(shared[1], /Domain=/);
    assert.match(shared[1], /Max-Age=0/);

    const cleared = clearSessionCookieHeaders(previewReq);
    assert.ok(Array.isArray(cleared));
    assert.equal(cleared.length, 2);
    assert.match(cleared[0], /; Domain=\.ab12\.monkeycode-ai\.live/);
    assert.doesNotMatch(cleared[1], /Domain=/);

    // Host-only deployments get a single header, not an array.
    assert.equal(typeof sessionCookieHeaders('tok', { headers: { host: 'app.example.com' } }), 'string');
    assert.equal(typeof clearSessionCookieHeaders({ headers: { host: 'app.example.com' } }), 'string');
  } finally {
    if (previous === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = previous;
  }
});
