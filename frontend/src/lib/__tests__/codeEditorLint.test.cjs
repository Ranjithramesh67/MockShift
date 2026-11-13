'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../components/CodeEditor.tsx'), 'utf8');

test('JSON language editor wires jsonParse-style lint', () => {
  assert.match(src, /jsonLint/);
  assert.match(src, /linter\(/);
  assert.match(src, /case 'json'/);
});
