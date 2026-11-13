'use strict';

// AUTO-2 / MON-4 — automation trigger (and any runWorkflow path) must call
// chargeRuns. Scheduled / event / monitor runs used to bypass the monthly
// quota that manual POST /workflows/:id/run already honours.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
});

after(async () => {
  const { shutdownWorkflows } = require('../src/api/workflowService');
  await shutdownWorkflows();
  if (closeApp) await closeApp();
});

test('automation trigger is blocked when the org is out of runs (AUTO-2)', async () => {
  await signupAndLogin(base, 'auto2-admin@test.io', 'adminpass123', 'Admin');
  const owner = await signupAndLogin(base, 'auto2-owner@test.io', 'ownerpass123', 'Owner');

  const ws = await owner.client.api('GET', '/api/workspaces');
  const tree = await owner.client.api(
    'GET',
    `/api/workspaces/${ws.json.workspaces[0].id}/content`
  );
  const projectId = tree.json.projects[0].id;

  const col = await owner.client.api('POST', '/api/collections', {
    projectId,
    name: 'AUTO-2',
  });
  assert.equal(col.status, 201);
  const req = await owner.client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Ping',
    method: 'GET',
    url: 'https://example.invalid/ping',
  });
  assert.equal(req.status, 201);

  const wf = await owner.client.api('POST', '/api/workflows', {
    projectId,
    name: 'AUTO-2 wf',
    definition: {
      steps: [
        {
          id: 's1',
          label: 'Ping',
          requestId: req.json.request.id,
          onFailure: 'abort',
        },
      ],
    },
  });
  assert.equal(wf.status, 201);

  const auto = await owner.client.api('POST', '/api/automations', {
    name: 'AUTO-2 auto',
    projectId,
    workflowId: wf.json.workflow.id,
    triggerType: 'WEBHOOK',
  });
  assert.equal(auto.status, 201);

  psql(
    `UPDATE plans SET limits = jsonb_set(coalesce(limits, '{}'::jsonb), '{runs_per_month}', '0') WHERE key = 'free'`
  );
  psql('UPDATE portal_settings SET restrictions_enforced = true;');
  try {
    const trigger = await owner.client.api(
      'POST',
      `/api/automations/${auto.json.automation.id}/trigger`
    );
    assert.equal(trigger.status, 403);
    assert.equal(trigger.json.code, 'plan_limit');
    assert.equal(trigger.json.key, 'runs_per_month');
  } finally {
    psql(
      `UPDATE plans SET limits = jsonb_set(coalesce(limits, '{}'::jsonb), '{runs_per_month}', 'null') WHERE key = 'free'`
    );
    psql('UPDATE portal_settings SET restrictions_enforced = false;');
  }
});
