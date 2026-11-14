'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const UUID = '3b50a855-b7d8-4f57-84a6-3cca6250f7c4';

function step(overrides) {
  return Object.assign({
    id: 'step_1',
    label: 'Call API',
    requestId: 'req_1',
    delayMs: 0,
    loop: { type: 'none' },
    onFailure: 'abort',
    formula: '',
  }, overrides || {});
}

test('loads persist helpers', () => {
  const helpers = require('../workflowPersist.js');
  assert.equal(typeof helpers.isPersistedWorkflowId, 'function');
  assert.equal(typeof helpers.workflowToDefinition, 'function');
  assert.equal(typeof helpers.storedToWorkflow, 'function');
  assert.equal(typeof helpers.persistWorkflow, 'function');
  assert.equal(typeof helpers.deletePersistedWorkflow, 'function');
});

test('isPersistedWorkflowId is true only for server UUIDs', () => {
  const { isPersistedWorkflowId } = require('../workflowPersist.js');
  assert.equal(isPersistedWorkflowId(UUID), true);
  assert.equal(isPersistedWorkflowId('wf_mmk1_abc123'), false);
  assert.equal(isPersistedWorkflowId(''), false);
  assert.equal(isPersistedWorkflowId(null), false);
});

test('workflowToDefinition wraps builder steps for POST/PUT', () => {
  const { workflowToDefinition } = require('../workflowPersist.js');
  const workflow = { id: 'wf_local', name: 'Order flow', steps: [step()] };
  assert.deepEqual(workflowToDefinition(workflow), { steps: [step()] });
});

test('storedToWorkflow maps API rows onto the builder shape', () => {
  const { storedToWorkflow } = require('../workflowPersist.js');
  const stored = {
    id: UUID,
    project_id: 'proj-1',
    name: 'Nightly',
    definition: { steps: [step({ id: 's2', label: 'Second' })] },
  };
  assert.deepEqual(storedToWorkflow(stored), {
    id: UUID,
    name: 'Nightly',
    steps: [step({ id: 's2', label: 'Second' })],
  });
});

test('storedToWorkflow defaults missing steps to an empty array', () => {
  const { storedToWorkflow } = require('../workflowPersist.js');
  assert.deepEqual(storedToWorkflow({ id: UUID, name: 'Empty' }), {
    id: UUID,
    name: 'Empty',
    steps: [],
  });
});

test('persistWorkflow POSTs local drafts and returns the server workflow', async () => {
  const { persistWorkflow } = require('../workflowPersist.js');
  const calls = [];
  const api = {
    create: async (input) => {
      calls.push(['create', input]);
      return {
        workflow: {
          id: UUID,
          project_id: input.projectId,
          name: input.name,
          definition: input.definition,
        },
      };
    },
    update: async () => {
      throw new Error('update should not run for a local id');
    },
  };
  const draft = { id: 'wf_local', name: 'Order flow', steps: [step()] };
  const saved = await persistWorkflow({ workflow: draft, projectId: 'proj-1', api });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], {
    projectId: 'proj-1',
    name: 'Order flow',
    definition: { steps: [step()] },
  });
  assert.equal(saved.id, UUID);
  assert.equal(saved.name, 'Order flow');
  assert.deepEqual(saved.steps, [step()]);
});

test('persistWorkflow PUTs when the id is already a server UUID', async () => {
  const { persistWorkflow } = require('../workflowPersist.js');
  const calls = [];
  const api = {
    create: async () => {
      throw new Error('create should not run for a persisted id');
    },
    update: async (id, patch) => {
      calls.push(['update', id, patch]);
      return {
        workflow: { id: id, project_id: 'proj-1', name: patch.name, definition: patch.definition },
      };
    },
  };
  const draft = { id: UUID, name: 'Renamed', steps: [step({ delayMs: 50 })] };
  const saved = await persistWorkflow({ workflow: draft, projectId: 'proj-1', api });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], UUID);
  assert.deepEqual(calls[0][2], {
    name: 'Renamed',
    definition: { steps: [step({ delayMs: 50 })] },
  });
  assert.equal(saved.id, UUID);
});

test('persistWorkflow rejects save without a project', async () => {
  const { persistWorkflow } = require('../workflowPersist.js');
  await assert.rejects(
    () => persistWorkflow({ workflow: { id: 'wf_x', name: 'X', steps: [] }, projectId: null, api: {} }),
    /project/i
  );
});

test('deletePersistedWorkflow skips the API for local-only ids', async () => {
  const { deletePersistedWorkflow } = require('../workflowPersist.js');
  let removed = 0;
  const api = { remove: async () => { removed += 1; } };
  const result = await deletePersistedWorkflow({ workflowId: 'wf_local', api });
  assert.equal(removed, 0);
  assert.equal(result.localOnly, true);
});

test('deletePersistedWorkflow DELETEs server workflows', async () => {
  const { deletePersistedWorkflow } = require('../workflowPersist.js');
  const calls = [];
  const api = { remove: async (id) => { calls.push(id); } };
  const result = await deletePersistedWorkflow({ workflowId: UUID, api });
  assert.deepEqual(calls, [UUID]);
  assert.equal(result.localOnly, false);
});

test('mergeLoadedWorkflows keeps local drafts when the server is empty', () => {
  const { mergeLoadedWorkflows } = require('../workflowPersist.js');
  const local = [{ id: 'wf_local', name: 'Order fulfilment', steps: [] }];
  assert.deepEqual(mergeLoadedWorkflows([], local), local);
});

test('mergeLoadedWorkflows prefers server graphs and keeps untitled local drafts', () => {
  const { mergeLoadedWorkflows } = require('../workflowPersist.js');
  const UUID = '3b50a855-b7d8-4f57-84a6-3cca6250f7c4';
  const server = [{ id: UUID, name: 'Nightly', steps: [] }];
  const local = [
    { id: UUID, name: 'stale', steps: [] },
    { id: 'wf_demo', name: 'Order fulfilment', steps: [] },
    { id: 'wf_new', name: 'Untitled workflow', steps: [] },
  ];
  assert.deepEqual(mergeLoadedWorkflows(server, local), [
    server[0],
    { id: 'wf_new', name: 'Untitled workflow', steps: [] },
  ]);
});

test('WorkflowBuilder and Sidebar persist graphs through workflowApi (WF-1)', () => {
  const builder = fs.readFileSync(path.join(__dirname, '../../components/WorkflowBuilder.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../../components/Sidebar.tsx'), 'utf8');
  assert.match(builder, /workflowApi/);
  assert.match(builder, /persistWorkflow/);
  assert.doesNotMatch(builder, /dispatch\(\{ type: 'SAVE_WORKFLOW', workflow: draft \}\)/);
  assert.match(sidebar, /workflowApi/);
  assert.match(sidebar, /persistWorkflow|deletePersistedWorkflow/);
});
