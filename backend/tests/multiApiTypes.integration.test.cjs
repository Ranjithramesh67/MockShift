'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startApp, makeClient, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;
let mockUpstream;
let mockBase;
let client;
let collectionId;

function startMock() {
  return new Promise((resolve) => {
    const upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = req.url.split('?')[0];
        if (url === '/graphql') {
          let payload = {};
          try { payload = body ? JSON.parse(body) : {}; } catch { payload = { query: body }; }
          const query = String(payload.query || '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (/ping/i.test(query)) return res.end(JSON.stringify({ data: { ping: 'pong' } }));
          return res.end(JSON.stringify({ errors: [{ message: 'Unknown field in query' }] }));
        }
        if (url === '/soap') {
          const ok = /GetUser/i.test(body);
          const xml = ok
            ? '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><User><id>1</id><name>Ada</name></User></soap:Body></soap:Envelope>'
            : '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>Unknown</faultstring></soap:Fault></soap:Body></soap:Envelope>';
          res.writeHead(ok ? 200 : 500, { 'Content-Type': 'text/xml' });
          return res.end(xml);
        }
        if (url === '/xml') {
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          return res.end('<note><ok>true</ok></note>');
        }
        if (url === '/echo-body') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(body);
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });
    upstream.listen(0, '127.0.0.1', () => resolve(upstream));
  });
}

before(async () => {
  mockUpstream = await startMock();
  mockBase = `http://127.0.0.1:${mockUpstream.address().port}`;
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
  const session = await signupAndLogin(base, 'multiapi@test.io', 'multipass123', 'Multi');
  client = session.client;
  const ws = await client.api('POST', '/api/workspaces', { name: 'Multi API Workspace' });
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await client.api('POST', '/api/collections', { projectId, name: 'Multi' });
  collectionId = col.json.collection.id;
});

after(async () => {
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  if (closeApp) await closeApp();
});

test('XML body_type persists', async () => {
  const created = await client.api('POST', '/api/requests', {
    collectionId, name: 'XML note', method: 'POST', url: `${mockBase}/xml`, apiType: 'REST',
  });
  assert.equal(created.status, 201);
  const patched = await client.api('PUT', `/api/requests/${created.json.request.id}`, {
    bodyType: 'XML', bodyText: '<note><ok>true</ok></note>',
  });
  assert.equal(patched.status, 200);
  const detail = await client.api('GET', `/api/requests/${created.json.request.id}`);
  assert.equal(detail.json.request.bodyType, 'XML');
  assert.equal(detail.json.request.bodyText, '<note><ok>true</ok></note>');
});

test('QUERY method persists', async () => {
  const created = await client.api('POST', '/api/requests', {
    collectionId, name: 'QUERY search', method: 'QUERY', url: `${mockBase}/echo-body`,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.request.method, 'QUERY');
});

test('GraphQL run returns ping pong', async () => {
  const created = await client.api('POST', '/api/requests', {
    collectionId, name: 'GQL ping', method: 'POST', url: `${mockBase}/graphql`, apiType: 'GRAPHQL',
  });
  await client.api('PUT', `/api/requests/${created.json.request.id}`, {
    bodyType: 'GRAPHQL', bodyJson: { query: '{ ping }' },
  });
  const run = await client.api('POST', `/api/requests/${created.json.request.id}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.runStatus, 'SUCCESS');
  assert.match(run.json.response.body, /pong/);
});

test('SOAP run returns Ada in an XML envelope', async () => {
  const created = await client.api('POST', '/api/requests', {
    collectionId, name: 'SOAP GetUser', method: 'POST', url: `${mockBase}/soap`, apiType: 'SOAP',
  });
  await client.api('PUT', `/api/requests/${created.json.request.id}`, {
    bodyType: 'XML', bodyText: '<GetUser><id>1</id></GetUser>',
  });
  const run = await client.api('POST', `/api/requests/${created.json.request.id}/run`);
  assert.equal(run.status, 200);
  assert.match(run.json.response.body, /Ada/);
  const ct = Object.entries(run.json.response.headers).find(([k]) => k.toLowerCase() === 'content-type');
  assert.ok(ct && /xml/i.test(ct[1]));
});

test('QUERY method sends a JSON body', async () => {
  const created = await client.api('POST', '/api/requests', {
    collectionId, name: 'QUERY body', method: 'QUERY', url: `${mockBase}/echo-body`,
  });
  await client.api('PUT', `/api/requests/${created.json.request.id}`, {
    method: 'QUERY', bodyType: 'JSON', bodyJson: { q: 'needle' },
  });
  const run = await client.api('POST', `/api/requests/${created.json.request.id}/run`);
  assert.equal(run.status, 200);
  const echoed = JSON.parse(run.json.response.body);
  assert.equal(echoed.q, 'needle');
});
