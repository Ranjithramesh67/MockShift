'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateWorkflow, sanitizeLabel } = require('../workflowValidation.js');

function step(overrides = {}) {
  return {
    id: 'step_1',
    label: 'Call API',
    requestId: 'req_1',
    delayMs: 0,
    loop: { type: 'none' },
    onFailure: 'abort',
    formula: '',
    ...overrides,
  };
}

function workflow(steps, name = 'Order flow') {
  return { id: 'wf_1', name, steps };
}

test('a plain sequential workflow is valid', () => {
  const result = validateWorkflow(
    workflow([step(), step({ id: 'step_2', label: 'Second' })])
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('fixed-count loop with a positive integer is valid', () => {
  const result = validateWorkflow(workflow([step({ loop: { type: 'count', count: 5 } })]));
  assert.equal(result.valid, true);
});

test('until-loop referencing an upstream step is valid', () => {
  const result = validateWorkflow(
    workflow([
      step({ id: 'order', label: 'Create order' }),
      step({
        id: 'poll',
        label: 'Poll status',
        loop: { type: 'until', condition: "$steps.order.response.body.status === 'complete'" },
      }),
    ])
  );
  assert.equal(result.valid, true);
});

test('rejects a zero count as an infinite/non-terminating loop', () => {
  const result = validateWorkflow(workflow([step({ loop: { type: 'count', count: 0 } })]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('non-terminating')));
});

test('rejects a negative count', () => {
  const result = validateWorkflow(workflow([step({ loop: { type: 'count', count: -3 } })]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('non-terminating')));
});

test('rejects a fractional or non-integer count', () => {
  const result = validateWorkflow(workflow([step({ loop: { type: 'count', count: 2.5 } })]));
  assert.equal(result.valid, false);
});

test('rejects an empty until-condition as an infinite loop', () => {
  const result = validateWorkflow(workflow([step({ loop: { type: 'until', condition: '' } })]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('would run forever')));
});

test('rejects an until-condition that references its own step', () => {
  const result = validateWorkflow(
    workflow([
      step({
        id: 'poll',
        label: 'Poll',
        loop: { type: 'until', condition: "$steps.poll.response.body.status === 'complete'" },
      }),
    ])
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('own result')));
});

test('rejects a workflow with no steps', () => {
  const result = validateWorkflow(workflow([]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('at least one step')));
});

test('rejects steps without a selected request', () => {
  const result = validateWorkflow(workflow([step({ requestId: null })]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('no request selected')));
});

test('accepts a passInputs entry that references an earlier step', () => {
  const result = validateWorkflow(
    workflow([
      step({ id: 'order', label: 'Create order' }),
      step({
        id: 'delivery',
        label: 'Deliver',
        passInputs: [
          {
            sourceStepId: 'order',
            data: 'response',
            field: 'id',
            target: 'header',
            targetKey: 'x-order-id',
          },
        ],
      }),
    ])
  );
  assert.equal(result.valid, true);
});

test('rejects a passInputs source that does not run before the step', () => {
  const result = validateWorkflow(
    workflow([
      step({ id: 'order', label: 'Create order' }),
      step({
        id: 'delivery',
        label: 'Deliver',
        passInputs: [{ sourceStepId: 'missing', data: 'response', target: 'header' }],
      }),
    ])
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('must be an earlier step')));
});

test('rejects a passInputs entry that references a later step', () => {
  const result = validateWorkflow(
    workflow([
      step({
        id: 'order',
        label: 'Create order',
        passInputs: [{ sourceStepId: 'later', data: 'response', target: 'body' }],
      }),
      step({ id: 'later', label: 'Later' }),
    ])
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('must be an earlier step')));
});

test('rejects a passInputs entry with an unknown data type or target', () => {
  const result = validateWorkflow(
    workflow([
      step({ id: 'order', label: 'Create order' }),
      step({
        id: 'delivery',
        label: 'Deliver',
        passInputs: [{ sourceStepId: 'order', data: 'cookie', target: 'cookie' }],
      }),
    ])
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('must be "request" or "response"')));
  assert.ok(result.errors.some((e) => e.message.includes('must be url, query, header or body')));
});

test('rejects a passInputs to url/query/header without a destination key', () => {
  const result = validateWorkflow(
    workflow([
      step({ id: 'order', label: 'Create order' }),
      step({
        id: 'delivery',
        label: 'Deliver',
        passInputs: [{ sourceStepId: 'order', data: 'response', target: 'header' }],
      }),
    ])
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('needs a destination key')));
});

test('sanitizeLabel produces a template-safe key', () => {
  assert.equal(sanitizeLabel('Create User'), 'create_user');
  assert.equal(sanitizeLabel('  GET /posts  '), 'get_posts');
  assert.equal(sanitizeLabel('Order Details'), 'order_details');
  assert.equal(sanitizeLabel(''), 'step');
});
