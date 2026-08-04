'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  contentTypeOf,
  isPdf,
  isImage,
  isBinaryResponse,
  responseLanguage,
  prettify,
  prettifyMarkup,
  base64ToBinaryString,
  responseBlob,
  filenameForResponse,
} = require('../responseView.js');

function response(overrides = {}) {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    durationMs: 5,
    ...overrides,
  };
}

test('contentTypeOf finds the content-type header case-insensitively', () => {
  assert.equal(contentTypeOf(response({ headers: { 'Content-Type': 'application/pdf' } })), 'application/pdf');
  assert.equal(contentTypeOf(response()), 'application/json');
  assert.equal(contentTypeOf(null), '');
  assert.equal(contentTypeOf({ headers: {} }), '');
});

test('isPdf detects via content-type and via %PDF- magic bytes', () => {
  assert.equal(isPdf(response({ headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4 ...' })), true);
  assert.equal(isPdf(response({ headers: { 'content-type': 'application/octet-stream' }, body: '%PDF-1.4 ...' })), true);
  assert.equal(isPdf(response({ headers: { 'content-type': 'text/plain' }, body: 'no pdf here' })), false);
  assert.equal(isPdf(null), false);
});

test('isImage detects image content types', () => {
  assert.equal(isImage(response({ headers: { 'content-type': 'image/png' }, body: '\x89PNG' })), true);
  assert.equal(isImage(response({ headers: { 'content-type': 'text/html' } })), false);
});

test('isBinaryResponse recognises base64 bodies, PDFs and images', () => {
  assert.equal(isBinaryResponse(response({ headers: { 'content-type': 'text/plain' }, bodyEncoding: 'base64', body: '...' })), true);
  assert.equal(isBinaryResponse(response({ headers: { 'content-type': 'application/pdf' } })), true);
  assert.equal(isBinaryResponse(response({ headers: { 'content-type': 'image/jpeg' } })), true);
  assert.equal(isBinaryResponse(response({ headers: { 'content-type': 'application/octet-stream' } })), true);
  assert.equal(isBinaryResponse(response()), false);
});

test('responseLanguage maps content types to editor languages', () => {
  assert.equal(responseLanguage(response()), 'json');
  assert.equal(responseLanguage(response({ headers: { 'content-type': 'application/xml' } })), 'xml');
  assert.equal(responseLanguage(response({ headers: { 'content-type': 'text/html' } })), 'html');
  assert.equal(responseLanguage(response({ headers: { 'content-type': 'text/plain' } })), 'text');
  assert.equal(responseLanguage(response({ headers: { 'content-type': 'application/x-protobuf' } })), 'json');
});

test('prettify formats valid JSON and leaves invalid JSON untouched', () => {
  assert.equal(prettify('{"a":1,"b":[1,2]}', 'json'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.equal(prettify('not json', 'json'), 'not json');
  assert.equal(prettify('', 'json'), '');
});

test('prettifyMarkup indents HTML by tag depth', () => {
  const out = prettifyMarkup('<div><p>Hello</p><br><ul><li>A</li></ul></div>');
  assert.equal(
    out,
    '<div>\n  <p>\n    Hello\n  </p>\n  <br>\n  <ul>\n    <li>\n      A\n    </li>\n  </ul>\n</div>'
  );
});

test('prettifyMarkup preserves comments and CDATA', () => {
  const input = '<!-- note --><root><![CDATA[a<b]]></root>';
  const out = prettifyMarkup(input);
  assert.match(out, /^<!-- note -->/);
  assert.match(out, /<!\[CDATA\[a<b\]\]>/);
});

test('base64ToBinaryString decodes correctly', () => {
  const input = 'Hello, PDF bytes!';
  const b64 = Buffer.from(input, 'binary').toString('base64');
  assert.equal(base64ToBinaryString(b64), input);
  assert.equal(base64ToBinaryString(''), '');
  assert.equal(base64ToBinaryString('SGVsbG8='), 'Hello');
});

test('responseBlob reconstructs base64 bodies into binary blobs', () => {
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
  const b64 = bytes.toString('base64');
  const blob = responseBlob(
    response({
      headers: { 'content-type': 'application/pdf' },
      bodyEncoding: 'base64',
      body: b64,
    })
  );
  assert.equal(blob.type, 'application/pdf');
  assert.equal(blob.size, bytes.length);
});

test('filenameForResponse derives a sensible filename', () => {
  assert.equal(filenameForResponse(response({ headers: { 'content-type': 'application/pdf' } }), 'http://x/files/sample.pdf'), 'sample.pdf');
  assert.equal(filenameForResponse(response(), 'http://x/posts'), 'posts.json');
  assert.equal(filenameForResponse(response({ headers: { 'content-type': 'image/png' } }), 'http://x/avatar'), 'avatar.png');
  assert.equal(filenameForResponse(response({ headers: { 'content-type': 'text/html' } }), 'http://x/page'), 'page.html');
});
