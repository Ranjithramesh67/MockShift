'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  makePartId,
  newTextPart,
  newFilePart,
  normalizeParts,
  stripTransportData,
  seedPartsFromLegacy,
} = require('../multipartParts.js');

test('makePartId produces unique ids', () => {
  const ids = new Set(Array.from({ length: 500 }, () => makePartId()));
  assert.equal(ids.size, 500);
  for (const id of ids) {
    assert.equal(typeof id, 'string');
    assert.ok(id.startsWith('p'));
    assert.ok(id.length > 4);
  }
});

test('newTextPart has text defaults', () => {
  const part = newTextPart();
  assert.equal(typeof part.id, 'string');
  assert.ok(part.id.length > 0);
  assert.equal(part.key, '');
  assert.equal(part.enabled, true);
  assert.equal(part.kind, 'text');
  assert.equal(part.value, '');
  assert.equal(part.fileName, undefined);
});

test('newFilePart has file defaults', () => {
  const part = newFilePart();
  assert.equal(typeof part.id, 'string');
  assert.ok(part.id.length > 0);
  assert.equal(part.key, '');
  assert.equal(part.enabled, true);
  assert.equal(part.kind, 'file');
  assert.equal(part.fileName, '');
  assert.equal(part.fileType, '');
  assert.equal(part.fileSize, 0);
  assert.equal(part.value, undefined);
});

test('normalizeParts always returns an array', () => {
  assert.deepEqual(normalizeParts(undefined), []);
  assert.deepEqual(normalizeParts(null), []);
  assert.deepEqual(normalizeParts('nope'), []);
  assert.deepEqual(normalizeParts({}), []);
  assert.deepEqual(normalizeParts(42), []);
});

test('normalizeParts drops junk entries and non-objects', () => {
  const out = normalizeParts([null, 'x', 3, { key: 'a', value: 'b' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'a');
  assert.equal(out[0].value, 'b');
});

test('normalizeParts strips data transport bytes', () => {
  const out = normalizeParts([
    {
      id: 'p1',
      key: 'avatar',
      enabled: true,
      kind: 'file',
      fileName: 'a.png',
      fileType: 'image/png',
      fileSize: 10,
      data: 'AAECAw==',
    },
    { id: 'p2', key: 'note', enabled: true, kind: 'text', value: 'hi', data: 'AAAA' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].data, undefined);
  assert.equal(out[1].data, undefined);
  assert.equal(out[0].fileName, 'a.png');
  assert.equal(out[1].value, 'hi');
});

test('normalizeParts coerces kinds and coerces missing ids/keys', () => {
  const out = normalizeParts([
    { id: 'keep', key: 'a', enabled: false, kind: 'text', value: 'v' },
    { kind: 'FILE', value: 'x' },
    { kind: 'file', fileName: 5, fileType: null, fileSize: '12' },
    { id: '', key: 'c' },
  ]);
  assert.equal(out.length, 4);
  assert.equal(out[0].id, 'keep');
  assert.equal(out[0].enabled, false);
  assert.equal(out[0].kind, 'text');
  // kind 'FILE' is not exactly 'file' -> coerced to text
  assert.equal(out[1].kind, 'text');
  assert.ok(typeof out[1].id === 'string' && out[1].id.length > 0);
  // file metadata coerced to strings / number
  assert.equal(out[2].kind, 'file');
  assert.equal(out[2].fileName, '');
  assert.equal(out[2].fileType, '');
  assert.equal(out[2].fileSize, 0);
  // empty id regenerated, given key preserved
  assert.ok(typeof out[3].id === 'string' && out[3].id.length > 0);
  assert.notEqual(out[3].id, '');
  assert.equal(out[3].key, 'c');
});

test('normalizeParts defaults enabled to true when absent', () => {
  const out = normalizeParts([{ key: 'a', kind: 'text', value: 'v' }]);
  assert.equal(out[0].enabled, true);
});

test('stripTransportData is pure and does not mutate its input', () => {
  const input = [
    { id: 'p1', key: 'f', enabled: true, kind: 'file', data: 'AAEC', fileName: 'f.bin' },
    { id: 'p2', key: 't', enabled: false, kind: 'text', value: 'v' },
  ];
  const copy = JSON.parse(JSON.stringify(input));
  const out = stripTransportData(input);
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
  assert.equal(out[0].data, undefined);
  assert.equal(out[1].data, undefined);
  assert.equal(out[1].enabled, false);
});

test('seedPartsFromLegacy parses k=v&k2=v2', () => {
  const out = seedPartsFromLegacy('name=Ada&role=admin');
  assert.equal(out.length, 2);
  assert.equal(out[0].key, 'name');
  assert.equal(out[0].value, 'Ada');
  assert.equal(out[0].enabled, true);
  assert.equal(out[0].kind, 'text');
  assert.ok(typeof out[0].id === 'string' && out[0].id.length > 0);
  assert.equal(out[1].key, 'role');
  assert.equal(out[1].value, 'admin');
});

test('seedPartsFromLegacy keeps empty values and splits on first =', () => {
  const out = seedPartsFromLegacy('a=&b=x=y');
  assert.equal(out.length, 2);
  assert.equal(out[0].key, 'a');
  assert.equal(out[0].value, '');
  assert.equal(out[1].key, 'b');
  assert.equal(out[1].value, 'x=y');
});

test('seedPartsFromLegacy returns [] for empty and non-strings', () => {
  assert.deepEqual(seedPartsFromLegacy(''), []);
  assert.deepEqual(seedPartsFromLegacy(null), []);
  assert.deepEqual(seedPartsFromLegacy(undefined), []);
  assert.deepEqual(seedPartsFromLegacy(42), []);
  assert.deepEqual(seedPartsFromLegacy({}), []);
});

test('seedPartsFromLegacy returns [] on garbage that is not key=value shaped', () => {
  assert.deepEqual(seedPartsFromLegacy('just-a-word'), []);
  assert.deepEqual(seedPartsFromLegacy('{"json":1}'), []);
  assert.deepEqual(seedPartsFromLegacy('&'), []);
  assert.deepEqual(seedPartsFromLegacy('=onlyvalue'), []);
});

test('seedPartsFromLegacy skips segments without an equals sign', () => {
  const out = seedPartsFromLegacy('good=1&barekey');
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'good');
  assert.equal(out[0].value, '1');
});
