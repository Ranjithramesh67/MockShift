'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const splitPane = fs.readFileSync(
  path.join(__dirname, '../../components/SplitPane.tsx'),
  'utf8'
);
const css = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

test('horizontal split drag uses col-resize body class, not row-resize', () => {
  assert.match(splitPane, /is-col-dragging/);
  assert.match(splitPane, /orientation === 'vertical'[\s\S]*is-dragging/);
  assert.doesNotMatch(
    splitPane,
    /document\.body\.classList\.add\('is-dragging'\);/
  );
});

test('formula horizontal first pane is overflow-hidden so the divider can resize', () => {
  assert.match(
    css,
    /\.formula-editor\s+\.split-pane-horizontal\s+\.split-pane-first\s*\{[^}]*overflow:\s*hidden/
  );
});

test('horizontal divider grip is a vertical bar (col-resize), not a 36x3 row handle', () => {
  assert.match(splitPane, /data-orientation=\{orientation\}/);
  assert.match(
    css,
    /\.split-pane-divider\[data-orientation=['"]horizontal['"]\]::after\s*\{[^}]*width:\s*3px[^}]*height:\s*36px/
  );
  assert.match(
    css,
    /\.split-pane-divider\[data-orientation=['"]horizontal['"]\]\s*\{[^}]*cursor:\s*col-resize/
  );
});
