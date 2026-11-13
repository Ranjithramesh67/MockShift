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
    /\.split-pane-divider\[data-orientation=['"]horizontal['"]\]::after[\s\S]*?\{[^}]*width:\s*3px[^}]*height:\s*36px/
  );
  assert.match(
    css,
    /\.split-pane-divider\[data-orientation=['"]horizontal['"]\][\s\S]*?\{[^}]*cursor:\s*col-resize/
  );
});

test('horizontal divider uses a dedicated col-resize class so grip CSS cannot lose', () => {
  assert.match(splitPane, /split-pane-divider-col/);
  assert.match(
    css,
    /\.split-pane-divider-col\s*\{[^}]*cursor:\s*col-resize/
  );
  assert.match(
    css,
    /\.split-pane-divider-col::after\s*\{[^}]*width:\s*3px[^}]*height:\s*36px/
  );
});

test('formula tab defaults helpers to the right (horizontal split)', () => {
  const configurator = fs.readFileSync(
    path.join(__dirname, '../../components/RequestConfigurator.tsx'),
    'utf8'
  );
  assert.match(
    configurator,
    /useState<'vertical' \| 'horizontal'>\('horizontal'\)/
  );
});
