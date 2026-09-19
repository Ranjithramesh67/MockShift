'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  methodsWithoutBody,
  defaultContentType,
  serializeBody,
  ensureSoapEnvelope,
} = require('../bodyCodec');

test('QUERY is allowed to carry a body', () => {
  assert.equal(methodsWithoutBody('GET'), true);
  assert.equal(methodsWithoutBody('HEAD'), true);
  assert.equal(methodsWithoutBody('QUERY'), false);
  assert.equal(methodsWithoutBody('POST'), false);
});

test('default content types', () => {
  assert.equal(defaultContentType({ bodyType: 'GRAPHQL', apiType: 'GRAPHQL' }), 'application/json');
  assert.equal(defaultContentType({ bodyType: 'XML', apiType: 'REST' }), 'application/xml');
  assert.equal(defaultContentType({ bodyType: 'XML', apiType: 'SOAP' }), 'text/xml');
  assert.equal(defaultContentType({ bodyType: 'JSON', apiType: 'REST' }), 'application/json');
});

test('serialize GraphQL object body', () => {
  const { body, contentType } = serializeBody(
    {
      body_type: 'GRAPHQL',
      api_type: 'GRAPHQL',
      body_json: { query: '{ ping }', variables: { a: 1 } },
      body_text: null,
    },
    { substitute: (s) => s, vars: {} }
  );
  assert.equal(contentType, 'application/json');
  assert.deepEqual(JSON.parse(body), { query: '{ ping }', variables: { a: 1 } });
});

test('serialize GraphQL raw query text as {query}', () => {
  const { body } = serializeBody(
    { body_type: 'GRAPHQL', api_type: 'GRAPHQL', body_json: null, body_text: '{ ping }' },
    { substitute: (s) => s, vars: {} }
  );
  assert.deepEqual(JSON.parse(body), { query: '{ ping }' });
});

test('serialize XML and wrap SOAP', () => {
  const xml = serializeBody(
    { body_type: 'XML', api_type: 'REST', body_json: null, body_text: '<id>1</id>' },
    { substitute: (s) => s, vars: {} }
  );
  assert.equal(xml.contentType, 'application/xml');
  assert.equal(xml.body, '<id>1</id>');
  const soap = serializeBody(
    { body_type: 'XML', api_type: 'SOAP', body_json: null, body_text: '<GetUser><id>1</id></GetUser>' },
    { substitute: (s) => s, vars: {} }
  );
  assert.equal(soap.contentType, 'text/xml');
  assert.match(soap.body, /soap:Envelope/);
  assert.match(soap.body, /GetUser/);
});

test('ensureSoapEnvelope is idempotent', () => {
  const once = ensureSoapEnvelope('<Hi/>');
  assert.equal(ensureSoapEnvelope(once), once);
});
