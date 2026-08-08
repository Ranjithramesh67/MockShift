'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  collectionFileName,
  parseCollectionFile,
  buildCurl,
  buildOpenApi,
  formatForDownload,
} = require('../collectionExport.js');

const SAMPLE = {
  format: 'api-hub-collection',
  version: 1,
  name: 'Mock API Demo',
  requests: [
    {
      sourceId: 'aaaa',
      name: 'GET all posts',
      method: 'GET',
      url: 'http://127.0.0.1:3999/posts?page=1',
      headers: [{ key: 'X-Debug', value: 'yes', enabled: true }],
      queryParams: [{ key: 'limit', value: '10', enabled: true }],
      bodyType: 'NONE',
      bodyJson: null,
      bodyText: null,
      apiType: 'REST',
      formula: '',
      assertions: [{ id: 'a1', type: 'status', operator: 'eq', expected: '200' }],
    },
    {
      sourceId: 'bbbb',
      name: 'Create post',
      method: 'POST',
      url: 'http://127.0.0.1:3999/posts',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      queryParams: [],
      bodyType: 'JSON',
      bodyJson: { title: 'Hi' },
      bodyText: null,
      apiType: 'REST',
      formula: '',
      assertions: [],
    },
    {
      sourceId: 'cccc',
      name: 'SOAP op',
      method: 'POST',
      url: 'http://soap.example.com/ws',
      headers: [],
      queryParams: [],
      bodyType: 'RAW_TEXT',
      bodyJson: '<soap/>',
      bodyText: '<soap/>',
      apiType: 'SOAP',
      formula: '',
      assertions: [],
    },
  ],
  authProvider: null,
};

test('collectionFileName slugs a name into a safe .json filename', () => {
  assert.equal(collectionFileName('Mock API Demo'), 'mock-api-demo.json');
  assert.equal(collectionFileName('  Users & Orders  '), 'users-orders.json');
  assert.equal(collectionFileName('!!!'), 'collection.json');
});

test('parseCollectionFile accepts a valid export and rejects garbage', () => {
  const ok = parseCollectionFile(JSON.stringify(SAMPLE));
  assert.equal(ok.name, 'Mock API Demo');
  assert.equal(ok.requestCount, 3);

  assert.throws(() => parseCollectionFile('{nope'), /not valid JSON/i);
  assert.throws(() => parseCollectionFile('{"name":"x"}'), /"requests" array/i);
  assert.throws(() => parseCollectionFile('"just a string"'), /Invalid collection file/i);
});

test('buildCurl emits one command per request', () => {
  const curls = buildCurl(SAMPLE);
  assert.equal(curls.length, 3);
  assert.equal(curls[0].name, 'GET all posts');
  assert.match(curls[0].curl, /^curl -X GET/);
  assert.match(curls[0].curl, /page=1&limit=10/);
  assert.match(curls[0].curl, /X-Debug: yes/);
  const create = curls[1].curl;
  assert.match(create, /-X POST/);
  assert.match(create, /Content-Type: application\/json/);
  assert.match(create, /--data-raw/);
  assert.match(create, /\{"title":"Hi"\}/);
});

test('buildOpenApi skips non-REST requests and maps paths/methods', () => {
  const doc = buildOpenApi(SAMPLE);
  assert.equal(doc.openapi, '3.0.0');
  assert.equal(doc.info.title, 'Mock API Demo');
  assert.deepEqual(Object.keys(doc.paths).sort(), ['/posts']);
  assert.ok(doc.paths['/posts'].get, 'GET operation present');
  assert.ok(doc.paths['/posts'].post, 'POST operation present');
  assert.ok(!doc.paths['/ws'], 'SOAP request excluded');
  const get = doc.paths['/posts'].get;
  assert.equal(get.summary, 'GET all posts');
  assert.ok(get.parameters.some((p) => p.name === 'X-Debug' && p.in === 'header'));
  assert.ok(get.parameters.some((p) => p.name === 'limit' && p.in === 'query'));
  assert.ok(get.parameters.every((p) => p.name !== 'Content-Type'), 'content-type header skipped');
  assert.ok(doc.paths['/posts'].post.requestBody, 'POST has a request body');
});

test('formatForDownload returns JSON, curl and openapi text', () => {
  const json = formatForDownload('json', SAMPLE);
  assert.doesNotThrow(() => JSON.parse(json));

  const curl = formatForDownload('curl', SAMPLE);
  assert.match(curl, /# GET all posts/);
  assert.match(curl, /curl -X GET/);

  const openapi = formatForDownload('openapi', SAMPLE);
  const doc = JSON.parse(openapi);
  assert.equal(doc.openapi, '3.0.0');
});
