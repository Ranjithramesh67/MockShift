'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  createSessionToken,
  verifySession: verify,
} = require('../authLib');

test('password hashing round-trips', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
});

test('hashes are salted (same password, different hashes)', () => {
  const a = hashPassword('pw');
  const b = hashPassword('pw');
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
