'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferSchema,
  mergeSchema,
  collapsePath,
  suggestAssertions,
  suggestFormulas,
} = require('../src/infer');

test('infers a nested schema from a JSON value', () => {
  const schema = inferSchema({ id: 1, name: 'Ada', tags: ['a', 'b'], meta: { ok: true } });
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.id.type, 'number');
  assert.equal(schema.properties.name.type, 'string');
  assert.equal(schema.properties.tags.type, 'array');
  assert.equal(schema.properties.tags.items.type, 'string');
  assert.equal(schema.properties.meta.properties.ok.type, 'boolean');
});

test('merges schemas by unioning object properties', () => {
  const a = inferSchema({ id: 1 });
  const b = inferSchema({ name: 'x' });
  const merged = mergeSchema(a, b);
  assert.deepEqual(Object.keys(merged.properties).sort(), ['id', 'name']);
});

test('collapses dynamic path segments to :id', () => {
  assert.equal(collapsePath('/users/42/posts'), '/users/:id/posts');
  assert.equal(
    collapsePath('/orders/6f1b2c3d-1111-2222-3333-444455556666'),
    '/orders/:id'
  );
  assert.equal(collapsePath('/health?verbose=1'), '/health');
});

test('applies custom path rules before collapsing', () => {
  assert.equal(
    collapsePath('/tenants/acme/users', { pathRules: [{ pattern: '/tenants/[^/]+', replacement: '/tenants/:tenant' }] }),
    '/tenants/:tenant/users'
  );
});

test('suggests a status assertion plus stable top-level fields', () => {
  const out = suggestAssertions(
    { status: 200, durationMs: 30, body: { id: 'abc', name: 'Ada', createdAt: '2026-01-01' } },
    { assertions: { status: true, json: true } }
  );
  const types = out.map((a) => a.type);
  assert.ok(types.includes('status'));
  const name = out.find((a) => a.path === 'name');
  assert.ok(name, 'expected a jsonPath assertion for name');
  assert.equal(name.operator, 'eq');
  assert.equal(name.expected, 'Ada');
  // ids and timestamps are excluded because they vary between runs
  assert.ok(!out.some((a) => a.path === 'id'));
  assert.ok(!out.some((a) => a.path === 'createdAt'));
});

test('can emit a status range assertion and a response-time budget', () => {
  const out = suggestAssertions(
    { status: 201, durationMs: 120, body: null },
    { assertions: { status: true, successStatus: 'range', maxResponseTimeMs: 500 } }
  );
  const status = out.find((a) => a.type === 'status');
  assert.equal(status.operator, 'lt');
  assert.equal(status.expected, '400');
  const time = out.find((a) => a.type === 'responseTime');
  assert.equal(time.operator, 'lt');
  assert.equal(time.expected, '500');
});

test('suggests formulas for dynamic body fields', () => {
  const out = suggestFormulas({ path: '/users/:id', bodyJson: { email: 'a@b.c', createdAt: 'x' } }, {});
  const codes = out.map((f) => f.code).join('\n');
  assert.match(codes, /req\.body\.email/);
  assert.match(codes, /req\.body\.createdAt/);
  assert.ok(out.some((f) => f.reason.includes('path segment')));
});
