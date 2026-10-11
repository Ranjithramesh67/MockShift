'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseGraphqlBody, serializeGraphqlBody, graphqlErrors } = require('../graphqlBody');

test('parseGraphqlBody splits query and variables', () => {
  const parsed = parseGraphqlBody('{"query":"{ ping }","variables":{"a":1}}');
  assert.equal(parsed.query, '{ ping }');
  assert.equal(JSON.parse(parsed.variables).a, 1);
});

test('parseGraphqlBody treats raw text as the query document', () => {
  const parsed = parseGraphqlBody('{ ping }');
  assert.equal(parsed.query, '{ ping }');
});

test('serializeGraphqlBody round-trips', () => {
  const raw = serializeGraphqlBody({ query: 'query { ping }', variables: '{"x":1}', operationName: 'Ping' });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.query, 'query { ping }');
  assert.deepEqual(parsed.variables, { x: 1 });
  assert.equal(parsed.operationName, 'Ping');
});

test('graphqlErrors reads errors[] from a 200 JSON body', () => {
  const errs = graphqlErrors({ body: '{"errors":[{"message":"Unknown field"}]}', headers: {} });
  assert.equal(errs.length, 1);
  assert.equal(errs[0].message, 'Unknown field');
  assert.deepEqual(graphqlErrors({ body: '{"data":{"ping":"pong"}}' }), []);
});
