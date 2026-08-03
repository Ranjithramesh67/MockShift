'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { substitute } = require('../runner');
const { roleAtLeast } = require('../access');

test('substitute replaces {{key}} templates', () => {
  const vars = { token: 'abc', region: 'eu' };
  assert.equal(substitute('https://x/{{region}}/a?t={{token}}', vars), 'https://x/eu/a?t=abc');
  assert.equal(substitute('no templates', vars), 'no templates');
  assert.equal(substitute('{{missing}} stays', vars), '{{missing}} stays');
  assert.equal(substitute(undefined, vars), undefined);
});

test('roleAtLeast orders ADMIN > EDITOR > VIEWER', () => {
  assert.equal(roleAtLeast('ADMIN', 'EDITOR'), true);
  assert.equal(roleAtLeast('EDITOR', 'EDITOR'), true);
  assert.equal(roleAtLeast('VIEWER', 'EDITOR'), false);
  assert.equal(roleAtLeast(null, 'VIEWER'), false);
});
