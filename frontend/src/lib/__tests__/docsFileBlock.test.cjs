'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '../docsApi.ts'), 'utf8');
const editor = fs.readFileSync(
  path.join(__dirname, '../../components/docs/BlockEditor.tsx'),
  'utf8'
);
const viewer = fs.readFileSync(
  path.join(__dirname, '../../components/docs/Mentions.tsx'),
  'utf8'
);

test('docs API admits a file block type with 10 MB cap', () => {
  assert.match(api, /'file'/);
  assert.match(api, /type: 'file', label: 'File'/);
  assert.match(api, /MAX_FILE_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
});

test('block editor has a File upload control', () => {
  assert.match(editor, /docs-add-\$\{l\.type\}/);
  assert.match(editor, /docs-field-file-upload/);
  assert.match(editor, /Choose file/);
  assert.match(editor, /10 MB/);
});

test('block viewer renders a file download', () => {
  assert.match(viewer, /docs-block-file/);
  assert.match(viewer, /download=/);
});
