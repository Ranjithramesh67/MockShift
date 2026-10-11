'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;
let client;
let other;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
  const session = await signupAndLogin(base, 'jsoncmp@test.io', 'jsonpass123', 'JsonCmp');
  client = session.client;
  const otherSession = await signupAndLogin(base, 'jsoncmp2@test.io', 'jsonpass123', 'JsonCmp2');
  other = otherSession.client;
});

after(async () => {
  if (closeApp) await closeApp();
});

test('saves, lists, updates and deletes a named comparison', async () => {
  const created = await client.api('POST', '/api/json-comparisons', {
    name: 'Checkout payloads',
    leftText: '{"b":1,"a":2}',
    rightText: '{"a":2,"b":1}',
    keyMode: 'alpha',
    arrayMode: 'numeric',
    keyDirection: 'desc',
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.comparison.name, 'Checkout payloads');
  assert.equal(created.json.comparison.keyMode, 'alpha');
  assert.equal(created.json.comparison.arrayMode, 'numeric');
  assert.equal(created.json.comparison.keyDirection, 'desc');
  const id = created.json.comparison.id;

  const listed = await client.api('GET', '/api/json-comparisons');
  assert.equal(listed.status, 200);
  assert.equal(listed.json.comparisons.length, 1);
  assert.equal(listed.json.comparisons[0].id, id);

  const updated = await client.api('PUT', `/api/json-comparisons/${id}`, {
    name: 'Checkout payloads v2',
    leftText: '{"a":1}',
    rightText: '{"a":2}',
    keyMode: 'alphanum',
    arrayMode: 'none',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.comparison.name, 'Checkout payloads v2');
  assert.equal(updated.json.comparison.leftText, '{"a":1}');
  assert.equal(updated.json.comparison.keyMode, 'alphanum');

  const hidden = await other.api('GET', '/api/json-comparisons');
  assert.equal(hidden.status, 200);
  assert.equal(hidden.json.comparisons.length, 0);

  const stolen = await other.api('DELETE', `/api/json-comparisons/${id}`);
  assert.equal(stolen.status, 404);

  const deleted = await client.api('DELETE', `/api/json-comparisons/${id}`);
  assert.equal(deleted.status, 204);
  const empty = await client.api('GET', '/api/json-comparisons');
  assert.equal(empty.json.comparisons.length, 0);
});

test('rejects a blank name and an invalid sort mode', async () => {
  const blank = await client.api('POST', '/api/json-comparisons', { name: '   ', leftText: '{}' });
  assert.equal(blank.status, 400);
  const bad = await client.api('POST', '/api/json-comparisons', {
    name: 'Bad sort',
    leftText: '{}',
    keyMode: 'nope',
  });
  assert.equal(bad.status, 400);
});
