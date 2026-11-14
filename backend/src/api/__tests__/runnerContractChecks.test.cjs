'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectRunAssertions } = require('../runner');

const PETS_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Pets API', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items'],
                  properties: {
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['id', 'name'],
                        properties: { id: { type: 'string' }, name: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const CHECK = {
  id: 'check-1',
  method: 'GET',
  path: '/pets',
  status_code: '200',
  spec: PETS_SPEC,
};

function response(body) {
  return { status: 200, headers: {}, body: JSON.stringify(body), bodyEncoding: 'text', durationMs: 12 };
}

test('Send includes attached contract checks in testResults (CON-1)', () => {
  const { testResults, assertionsPassed } = collectRunAssertions(
    { assertions: [] },
    response({ items: [{ id: '1', name: 'Rex' }] }),
    [CHECK]
  );
  assert.equal(testResults.length, 1);
  assert.equal(testResults[0].id, 'check-1');
  assert.equal(testResults[0].passed, true);
  assert.equal(assertionsPassed, true);
});

test('failed contract check fails the Send assertions even when HTTP 200', () => {
  const { testResults, assertionsPassed } = collectRunAssertions(
    { assertions: [{ id: 's1', type: 'status', operator: 'eq', expected: '200' }] },
    response({ items: [{}] }),
    [CHECK]
  );
  assert.equal(testResults.length, 2);
  assert.equal(testResults[0].passed, true);
  assert.equal(testResults[1].passed, false);
  assert.equal(assertionsPassed, false);
});

test('no attached checks leaves request assertions unchanged', () => {
  const { testResults, assertionsPassed } = collectRunAssertions(
    { assertions: [{ id: 's1', type: 'status', operator: 'eq', expected: '200' }] },
    response({ ok: true }),
    []
  );
  assert.equal(testResults.length, 1);
  assert.equal(testResults[0].id, 's1');
  assert.equal(assertionsPassed, true);
});
