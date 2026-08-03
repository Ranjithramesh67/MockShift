'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCurl, generateCurl, tokenizeCurl } = require('../curl.js');

const COMPLEX_CURL = [
  'curl --silent --compressed --location \\',
  "  -X POST 'https://api.example.com/v2/orders?expand=items&page=1' \\",
  "  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token:with:colons' \\",
  "  -H 'Content-Type: application/json' \\",
  "  -H 'Accept: application/json' \\",
  "  -H 'X-Trace-Id: 7f3c-9a2b' \\",
  "  -H 'Cookie: session=abc123; theme=dark' \\",
  "  --data-raw '{\"customer\":{\"id\":\"cus_123\"},\"items\":[{\"sku\":\"A1\",\"qty\":2}],\"note\":\"say \\\"hi\\\"\"}'",
].join('\n');

test('tokenizer honours quotes, escapes and line continuations', () => {
  const tokens = tokenizeCurl(
    "curl -X POST 'https://a.com/x' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"k\":\"say \\\"hi\\\"\"}'"
  );
  assert.deepEqual(tokens, [
    'curl',
    '-X',
    'POST',
    'https://a.com/x',
    '-H',
    'Content-Type: application/json',
    '--data-raw',
    '{"k":"say \\"hi\\""}',
  ]);
});

test('parses a complex curl into method, url, headers, params and JSON body', () => {
  const req = parseCurl(COMPLEX_CURL);

  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://api.example.com/v2/orders');
  assert.equal(req.bodyType, 'JSON');
  assert.equal(req.contentType, 'application/json');

  const headers = Object.fromEntries(req.headers.map((h) => [h.key, h.value]));
  assert.equal(headers['Authorization'], 'Bearer eyJhbGciOiJIUzI1NiJ9.token:with:colons');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Accept'], 'application/json');
  assert.equal(headers['X-Trace-Id'], '7f3c-9a2b');
  assert.equal(headers['Cookie'], 'session=abc123; theme=dark');
  assert.ok(req.headers.every((h) => h.enabled));

  const params = Object.fromEntries(req.queryParams.map((p) => [p.key, p.value]));
  assert.deepEqual(params, { expand: 'items', page: '1' });

  const body = JSON.parse(req.bodyJson);
  assert.equal(body.customer.id, 'cus_123');
  assert.equal(body.items[0].sku, 'A1');
  assert.equal(body.items[0].qty, 2);
  assert.equal(body.note, 'say "hi"');
});

test('round-trips through generateCurl preserving headers and body', () => {
  const req = parseCurl(COMPLEX_CURL);
  const regenerated = generateCurl(req);
  const reparsed = parseCurl(regenerated);

  assert.equal(reparsed.method, 'POST');
  assert.equal(reparsed.url, req.url);
  assert.deepEqual(
    reparsed.headers.map((h) => `${h.key}: ${h.value}`).sort(),
    req.headers.map((h) => `${h.key}: ${h.value}`).sort()
  );
  assert.deepEqual(JSON.parse(reparsed.bodyJson), JSON.parse(req.bodyJson));
  assert.deepEqual(reparsed.queryParams, req.queryParams);
});

test('infers POST when -d data is present without -X', () => {
  const req = parseCurl("curl -d 'name=alice' -H 'Content-Type: application/x-www-form-urlencoded' https://api.example.com/users");
  assert.equal(req.method, 'POST');
  assert.equal(req.bodyType, 'FORM_URLENCODED');
  assert.equal(req.bodyText, 'name=alice');
});

test('-G with -d moves the data into query params as GET', () => {
  const req = parseCurl("curl -G -d 'search=hello world' -d 'limit=5' 'https://api.example.com/search'");
  assert.equal(req.method, 'GET');
  assert.equal(req.bodyType, 'NONE');
  assert.deepEqual(Object.fromEntries(req.queryParams.map((p) => [p.key, p.value])), {
    search: 'hello world',
    limit: '5',
  });
});

test('-u user:pass produces a Basic Authorization header', () => {
  const req = parseCurl("curl -u 'admin:password123' 'https://api.example.com/status'");
  assert.equal(req.method, 'GET');
  const auth = req.headers.find((h) => h.key.toLowerCase() === 'authorization');
  assert.ok(auth);
  assert.equal(auth.value, `Basic ${Buffer.from('admin:password123').toString('base64')}`);
});

test('keeps -F multipart form fields as a text body', () => {
  const req = parseCurl("curl -X POST 'https://api.example.com/upload' -F 'file=@./photo.png'");
  assert.equal(req.method, 'POST');
  assert.equal(req.bodyType, 'MULTIPART');
  assert.equal(req.bodyText, 'file=@./photo.png');
});
