'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// requestForm.ts is compiled away in unit tests; re-assert the CJS-adjacent
// contracts that graphqlBody + body-kind mapping must keep.
const { serializeGraphqlBody } = require('../graphqlBody');

test('GraphQL default seed is valid JSON with a ping query', () => {
  const seed = serializeGraphqlBody({ query: 'query { ping }', variables: '{}' });
  const parsed = JSON.parse(seed);
  assert.equal(parsed.query, 'query { ping }');
  assert.deepEqual(parsed.variables, {});
});
