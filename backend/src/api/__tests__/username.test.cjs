'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { USERNAME_RE, usernameError, allocateUsername } = require('../username');

test('username format accepts 3–30 letter-start tokens', () => {
  assert.equal(USERNAME_RE.test('dev'), true);
  assert.equal(USERNAME_RE.test('boss'), true);
  assert.equal(USERNAME_RE.test('Ada_Lovelace1'), true);
  assert.equal(USERNAME_RE.test('pm'), false);
  assert.equal(USERNAME_RE.test('1abc'), false);
  assert.equal(USERNAME_RE.test('ab'), false);
  assert.equal(usernameError('ok'), 'Username must be 3–30 characters, start with a letter, and use only letters, numbers, and underscores');
  assert.equal(usernameError('valid_name'), null);
});

test('allocateUsername uses an explicit unique name', async () => {
  const exec = async () => ({ rows: [] });
  const name = await allocateUsername(exec, { username: 'Ada_1', email: 'a@test.io', name: 'Ada' });
  assert.equal(name, 'Ada_1');
});

test('allocateUsername rejects a taken explicit name', async () => {
  const exec = async () => ({ rows: [{ id: 'x' }] });
  await assert.rejects(
    () => allocateUsername(exec, { username: 'taken', email: 'a@test.io' }),
    (err) => err.status === 409 && /already taken/.test(err.message)
  );
});

test('allocateUsername derives and uniquifies from email', async () => {
  const seen = new Set();
  const exec = async (_sql, params) => ({ rows: seen.has(params[0].toLowerCase()) ? [{ id: 'x' }] : [] });
  seen.add('picker123');
  const name = await allocateUsername(exec, { email: 'picker123@test.io', name: 'P' });
  assert.equal(name, 'picker1232');
});
