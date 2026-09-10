'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'tokens.ts'), 'utf8');

test('tokens lib exposes the sdk scope and binding fields', () => {
  assert.match(src, /'sdk'/);
  assert.match(src, /projectId/);
  assert.match(src, /workspaceId/);
});

test('tokens lib labels the sdk scope', () => {
  assert.match(src, /sdk:\s*'SDK \/ route sync'/);
});
