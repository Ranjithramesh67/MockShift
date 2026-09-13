'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tokenFromSearch, passwordProblem } = require('../authLinks');

test('tokenFromSearch reads a token, with or without a leading ?', () => {
  assert.equal(tokenFromSearch('?token=abc_123-XYZ'), 'abc_123-XYZ');
  assert.equal(tokenFromSearch('foo=1&token=abc_123-XYZ'), 'abc_123-XYZ');
  assert.equal(tokenFromSearch('?foo=1'), null);
  assert.equal(tokenFromSearch(''), null);
});

test('passwordProblem enforces length and confirmation', () => {
  assert.equal(passwordProblem('longenough', 'longenough'), null);
  assert.equal(passwordProblem('short', 'short'), 'Password must be at least 8 characters');
  assert.equal(passwordProblem('longenough', 'different1'), 'Passwords do not match');
  assert.equal(passwordProblem('', ''), 'Password must be at least 8 characters');
});
