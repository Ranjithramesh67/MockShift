'use strict';

// LOW-7 — syncAllSchedules must remove schedulers whose automation was
// disabled/deleted while the process was down, while leaving unrelated
// schedulers alone.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startApp } = require('./support/harness.cjs');

let app;
let wf;

before(async () => {
  app = await startApp();
  wf = require('../src/api/workflowService');
});

after(async () => {
  if (wf) await wf.shutdownWorkflows();
  if (app) await app.close();
});

test('syncAllSchedules drops stale automation schedulers', async () => {
  const staleId = `automation:${randomUUID()}`;
  const foreignId = `cron:other-${randomUUID()}`;

  await wf.getScheduler().registerCron({ workflowId: randomUUID(), cron: '0 * * * *', jobId: staleId });
  await wf.getScheduler().registerCron({ workflowId: randomUUID(), cron: '0 9 * * *', jobId: foreignId });

  let keys = await wf.listScheduleKeys();
  assert.ok(keys.includes(staleId), 'setup: stale scheduler registered');
  assert.ok(keys.includes(foreignId), 'setup: foreign scheduler registered');

  await wf.syncAllSchedules();

  keys = await wf.listScheduleKeys();
  assert.ok(!keys.includes(staleId), 'stale automation scheduler must be removed');
  assert.ok(keys.includes(foreignId), 'non-automation schedulers must be left alone');
});
