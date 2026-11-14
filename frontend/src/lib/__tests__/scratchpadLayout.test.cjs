'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appShell = fs.readFileSync(
  path.join(__dirname, '../../components/AppShell.tsx'),
  'utf8'
);

test('scratchpad opens as a split beside the request editor (SCRATCH-1)', () => {
  assert.doesNotMatch(
    appShell,
    /if \(scratchpadOpen\) \{\s*return <ScratchpadWorkspace/
  );
  assert.match(appShell, /scratchpadOpen/);
  assert.match(appShell, /ScratchpadWorkspace/);
  assert.match(appShell, /RequestConfigurator/);
  assert.match(
    appShell,
    /scratchpadOpen[\s\S]*SplitPane[\s\S]*ScratchpadWorkspace/
  );
});
