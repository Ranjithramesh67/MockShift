'use strict';

// LOW-2 — PATCH /environments/:id must report the real variable_count instead
// of hardcoding 0.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let app;

before(async () => {
  app = await startApp();
});

after(async () => {
  if (app) await app.close();
});

test('PATCH environment returns the real variable_count', async () => {
  const owner = await signupAndLogin(app.base, 'env-count@test.io', 'envcount123', 'Env Count');
  const workspaces = await owner.client.api('GET', '/api/workspaces');
  const workspaceId = workspaces.json.workspaces[0].id;

  const created = await owner.client.api('POST', `/api/workspaces/${workspaceId}/environments`, { name: 'Staging' });
  assert.equal(created.status, 201);
  const environmentId = created.json.environment.id;

  for (const key of ['API_HOST', 'API_KEY']) {
    const res = await owner.client.api('POST', `/api/environments/${environmentId}/variables`, { key, value: 'x' });
    assert.equal(res.status, 201, `create variable ${key}`);
  }

  const patched = await owner.client.api('PATCH', `/api/environments/${environmentId}`, { name: 'Staging 2' });
  assert.equal(patched.status, 200);
  assert.equal(Number(patched.json.environment.variable_count), 2, 'variable_count must reflect stored variables');

  const listed = await owner.client.api('GET', `/api/workspaces/${workspaceId}/environments`);
  const row = listed.json.environments.find((e) => e.id === environmentId);
  assert.equal(Number(row.variable_count), 2, 'list and patch agree');
});
