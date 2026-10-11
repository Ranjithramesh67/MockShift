'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDataset, datasetSummary, MAX_DATA_ROWS } = require('../collectionRun.js');

test('parseDataset reads a JSON array of objects', () => {
  const rows = parseDataset('[{"email":"a@b.io","n":1}]');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'a@b.io');
});

test('parseDataset rejects JSON that is not an array', () => {
  assert.throws(() => parseDataset('{"a":1}'), /array of objects/);
});

test('parseDataset rejects malformed JSON', () => {
  assert.throws(() => parseDataset('[{"a":1}'), /not valid JSON/);
});

test('parseDataset reads CSV with a header row', () => {
  const rows = parseDataset('email,role\na@b.io,admin\nc@d.io,viewer\n');
  assert.deepEqual(rows, [
    { email: 'a@b.io', role: 'admin' },
    { email: 'c@d.io', role: 'viewer' },
  ]);
});

test('parseDataset handles quoted CSV values with commas and quotes', () => {
  const rows = parseDataset('name,note\n"Smith, John","say ""hi"""\n');
  assert.deepEqual(rows, [{ name: 'Smith, John', note: 'say "hi"' }]);
});

test('parseDataset handles embedded newlines inside quotes', () => {
  const rows = parseDataset('a,b\n"line1\nline2",x\n');
  assert.equal(rows[0].a, 'line1\nline2');
  assert.equal(rows[0].b, 'x');
});

test('parseDataset returns [] for empty input', () => {
  assert.deepEqual(parseDataset('   '), []);
});

test('parseDataset caps the number of rows', () => {
  const rows = parseDataset(JSON.stringify(Array.from({ length: MAX_DATA_ROWS + 10 }, (_, i) => ({ i }))));
  assert.equal(rows.length, MAX_DATA_ROWS);
});

test('parseDataset can force CSV parsing', () => {
  const rows = parseDataset('1,2', 'csv');
  assert.deepEqual(rows, []);
});

test('datasetSummary reports rows and columns', () => {
  assert.equal(datasetSummary([{ a: 1, b: 2 }]), '1 row · 2 columns');
  assert.equal(datasetSummary([]), 'No data rows');
});
