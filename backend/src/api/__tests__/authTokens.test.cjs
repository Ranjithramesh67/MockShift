'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateToken,
  hashToken,
  TOKEN_TTL_MS,
  expiryFor,
  createThrottle,
} = require('../authTokens');

test('generateToken returns unique url-safe secrets', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 40);
});

test('hashToken is a stable sha256 hex digest', () => {
  const h = hashToken('abc');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashToken('abc'));
  assert.notEqual(h, hashToken('abd'));
});

test('expiryFor applies the per-kind ttl', () => {
  const now = 1_700_000_000_000;
  assert.equal(expiryFor('password_reset', now).getTime(), now + TOKEN_TTL_MS.password_reset);
  assert.equal(
    expiryFor('email_verification', now).getTime(),
    now + TOKEN_TTL_MS.email_verification
  );
  assert.equal(expiryFor('nope', now), null);
});

test('createThrottle limits calls per key inside the window', () => {
  const throttle = createThrottle({ windowMs: 1000, max: 2 });
  const t0 = 1000;
  assert.equal(throttle.allow('a@x', t0), true);
  assert.equal(throttle.allow('a@x', t0 + 1), true);
  assert.equal(throttle.allow('a@x', t0 + 2), false);
  assert.equal(throttle.allow('b@x', t0 + 2), true);
  assert.equal(throttle.allow('a@x', t0 + 1001), true);
});
