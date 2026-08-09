'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  redactSnapshot,
  redactHeaders,
  redactBody,
  redactUrl,
  DEFAULT_MARKER,
} = require('../redact');

const M = DEFAULT_MARKER;

test('redacts a query-string token', () => {
  const url = redactUrl('https://api.example.com/v1/posts?access_token=abc123&page=2', [], [], M);
  assert.equal(url, `https://api.example.com/v1/posts?access_token=${encodeURIComponent(M)}&page=2`);
  assert.ok(!url.includes('abc123'));
});

test('redacts credentials in URL userinfo', () => {
  const url = redactUrl('https://alice:hunter2@example.com/path', [], [], M);
  assert.ok(url.startsWith('https://'));
  assert.ok(url.includes('@example.com/path'));
  assert.ok(!url.includes('hunter2'));
  assert.ok(!url.includes('alice:'));
});

test('redacts OAuth2 JSON request body', () => {
  const body = JSON.stringify({
    client_id: 'app-123',
    client_secret: 'super-secret-value',
    grant_type: 'client_credentials',
    data: { token: 'jwt-ish' },
  });
  const out = redactBody(body, [], [], M);
  const parsed = JSON.parse(out);
  assert.equal(parsed.client_id, 'app-123');
  assert.equal(parsed.client_secret, M);
  assert.equal(parsed.grant_type, 'client_credentials');
  assert.equal(parsed.data.token, M);
});

test('redacts Set-Cookie response header', () => {
  const headers = redactHeaders(
    { 'content-type': 'application/json', 'set-cookie': 'session=abc123; Path=/; HttpOnly' },
    [],
    [],
    M
  );
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['set-cookie'], M);
});

test('redacts an Authorization header with a Bearer token', () => {
  const headers = redactHeaders({ Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.token.sig' }, [], [], M);
  assert.equal(headers.Authorization, M);
});

test('redacts SOAP wsse:Password element', () => {
  const soap =
    '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soap:Body><wsse:Security><wsse:Password>hunter2secret</wsse:Password></wsse:Security></soap:Body></soap:Envelope>';
  const out = redactBody(soap, [], [], M);
  assert.ok(!out.includes('hunter2secret'));
  assert.ok(out.includes(`>${M}<`));
  assert.ok(out.includes('wsse:Password'));
});

test('redacts a secret mid-sentence in a plain-text body', () => {
  const out = redactBody('Please use my-token-xyz for auth in production.', ['my-token-xyz'], [], M);
  assert.ok(!out.includes('my-token-xyz'));
  assert.ok(out.includes(M));
});

test('redacts a form-urlencoded password field', () => {
  const out = redactBody('username=bob&password=topsecret&remember=1', [], [], M);
  assert.equal(out, `username=bob&password=${encodeURIComponent(M)}&remember=1`);
});

test('redacts a multipart body part whose name matches', () => {
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\nsk-live-12345\r\n--${boundary}--`;
  const out = redactBody(body, [], [], M);
  assert.ok(!out.includes('sk-live-12345'));
  assert.ok(out.includes(M));
});

test('redacts deeply nested JSON at any depth', () => {
  const body = JSON.stringify({
    level1: {
      level2: {
        level3: { password: 'pw123', note: 'fine' },
        arr: [{ client_secret: 'cs1' }, { ok: 1 }],
      },
    },
  });
  const parsed = JSON.parse(redactBody(body, [], [], M));
  assert.equal(parsed.level1.level2.level3.password, M);
  assert.equal(parsed.level1.level2.level3.note, 'fine');
  assert.equal(parsed.level1.level2.arr[0].client_secret, M);
  assert.equal(parsed.level1.level2.arr[1].ok, 1);
});

test('byte-identical when no secrets present', () => {
  const snapshot = {
    url: 'https://api.example.com/ok?page=2',
    headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
    body: JSON.stringify({ name: 'alice', age: 30 }),
  };
  assert.deepEqual(redactSnapshot(snapshot), snapshot);
});

test('redaction is idempotent', () => {
  const snapshot = {
    url: 'https://api.example.com/login?token=abc123',
    headers: { authorization: 'Basic dXNlcjpwYXNz' },
    body: JSON.stringify({ username: 'bob', password: 'secret' }),
  };
  const once = redactSnapshot(snapshot);
  const twice = redactSnapshot(once);
  assert.deepEqual(once, twice);
});

test('does not mutate the input snapshot', () => {
  const snapshot = {
    url: 'https://api.example.com/x?token=abc123',
    headers: { authorization: 'Bearer tok.ey.sig', 'x-safe': 'v' },
    body: JSON.stringify({ password: 'p1', nested: { secret: 's1' } }),
  };
  const before = JSON.stringify(snapshot);
  redactSnapshot(snapshot, { secretValues: ['extra'] });
  assert.equal(JSON.stringify(snapshot), before);
});

test('redacts a full request snapshot', () => {
  const snapshot = {
    url: 'https://api.example.com/token?grant=client_credentials',
    method: 'POST',
    headers: { authorization: 'Basic base64stuff', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: 'c', client_secret: 'very-secret' }),
  };
  const out = redactSnapshot(snapshot);
  assert.equal(out.headers.authorization, M);
  assert.equal(JSON.parse(out.body).client_secret, M);
  assert.equal(JSON.parse(out.body).client_id, 'c');
});

test('redacts a full response snapshot (body + headers)', () => {
  const snapshot = {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', 'set-cookie': 'sid=abc; HttpOnly' },
    body: JSON.stringify({ token: 'eyJ.eyJ.sig', user: { id: 7 } }),
    bodyEncoding: 'text',
    durationMs: 12,
  };
  const out = redactSnapshot(snapshot);
  assert.equal(out.headers['set-cookie'], M);
  assert.equal(JSON.parse(out.body).token, M);
  assert.equal(JSON.parse(out.body).user.id, 7);
  assert.equal(out.status, 200);
});

test('JWT-shaped values are redacted as values (rule 3)', () => {
  const body = JSON.stringify({ id_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123sig' });
  const parsed = JSON.parse(redactBody(body, [], [], M));
  assert.equal(parsed.id_token, M);
});

test('custom marker and extra key patterns are honoured', () => {
  const snapshot = {
    url: 'https://x/y',
    headers: { 'x-phone-number': '555-1234' },
    body: 'name=jane',
  };
  const out = redactSnapshot(snapshot, {
    marker: '[SECRET]',
    extraKeyPatterns: ['phone'],
  });
  assert.equal(out.headers['x-phone-number'], '[SECRET]');
});
