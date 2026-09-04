'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultScratchDraft,
  scratchDraftToRunInput,
  scratchDraftToServerPatch,
} = require('../scratchpadDraft.js');

test('default draft has the expected shape', () => {
  assert.deepEqual(defaultScratchDraft(), {
    method: 'GET',
    url: '',
    headers: [],
    queryParams: [],
    bodyType: 'NONE',
    bodyJson: null,
    bodyText: null,
    bodyParts: [],
    contentType: 'text/plain',
    apiType: 'REST',
    formula: '',
    assertions: [],
  });
});

test('run input maps a GET draft', () => {
  const draft = {
    method: 'GET',
    url: 'https://api.example.com/posts?page=2',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    queryParams: [{ key: 'page', value: '2', enabled: true }],
    bodyType: 'NONE',
    bodyJson: null,
    bodyText: null,
    apiType: 'REST',
    formula: '',
    assertions: [],
  };
  assert.deepEqual(scratchDraftToRunInput(draft), {
    method: 'GET',
    url: 'https://api.example.com/posts?page=2',
    headers: draft.headers,
    queryParams: draft.queryParams,
    bodyType: 'NONE',
    bodyJson: null,
    bodyText: null,
    bodyParts: [],
    formula: '',
    assertions: [],
    apiType: 'REST',
  });
});

test('run input parses a valid JSON body', () => {
  const draft = {
    method: 'POST',
    url: 'https://api.example.com/orders',
    headers: [],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: '{"sku":"A1","qty":2}',
    bodyText: null,
    apiType: 'REST',
    formula: '',
    assertions: [],
  };
  const input = scratchDraftToRunInput(draft);
  assert.equal(input.bodyType, 'JSON');
  assert.deepEqual(input.bodyJson, { sku: 'A1', qty: 2 });
  assert.equal(input.bodyText, null);
});

test('run input falls back to raw bodyJson on parse failure', () => {
  const draft = {
    method: 'POST',
    url: 'https://api.example.com/orders',
    headers: [],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: '{not json',
    bodyText: null,
    apiType: 'REST',
    formula: '',
    assertions: [],
  };
  const input = scratchDraftToRunInput(draft);
  assert.equal(input.bodyType, 'JSON');
  assert.equal(input.bodyJson, '{not json');
  assert.equal(input.bodyText, null);
});

test('server patch parses a valid JSON body into an object', () => {
  const draft = {
    method: 'POST',
    url: 'https://api.example.com/orders',
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: '{"sku":"A1"}',
    bodyText: null,
    apiType: 'REST',
    formula: 'status == 201',
    assertions: [{ id: 'a1', type: 'STATUS', operator: 'EQ', expected: '201' }],
  };
  const patch = scratchDraftToServerPatch(draft);
  assert.deepEqual(patch.bodyJson, { sku: 'A1' });
  assert.equal(patch.bodyText, undefined);
  assert.equal(patch.bodyType, 'JSON');
  assert.equal(patch.formula, 'status == 201');
  assert.deepEqual(patch.assertions, [{ id: 'a1', type: 'STATUS', operator: 'EQ', expected: '201' }]);
});

test('server patch falls back to bodyText on unparseable JSON', () => {
  const draft = {
    bodyType: 'JSON',
    bodyJson: '{broken',
    bodyText: null,
    headers: [],
    queryParams: [],
    formula: '',
    assertions: [],
  };
  const patch = scratchDraftToServerPatch(draft);
  assert.equal(patch.bodyJson, null);
  assert.equal(patch.bodyText, '{broken');
});

test('server patch clears both body fields for an empty JSON body', () => {
  const patch = scratchDraftToServerPatch({
    bodyType: 'JSON',
    bodyJson: '',
    bodyText: null,
    headers: [],
    queryParams: [],
    formula: '',
    assertions: [],
  });
  assert.equal(patch.bodyJson, null);
  assert.equal(patch.bodyText, null);
});

test('server patch moves bodyJson to bodyText for non-JSON bodies', () => {
  const patch = scratchDraftToServerPatch({
    bodyType: 'RAW_TEXT',
    bodyJson: 'hello world',
    bodyText: null,
    headers: [],
    queryParams: [],
    formula: '',
    assertions: [],
  });
  assert.equal(patch.bodyJson, null);
  assert.equal(patch.bodyText, 'hello world');
  assert.equal(patch.bodyType, 'RAW_TEXT');
});

test('headers/queryParams default to [] when absent', () => {
  const input = scratchDraftToRunInput({ method: 'POST', url: 'https://x.test' });
  assert.deepEqual(input.headers, []);
  assert.deepEqual(input.queryParams, []);

  const patch = scratchDraftToServerPatch({ bodyType: 'NONE' });
  assert.deepEqual(patch.headers, []);
  assert.deepEqual(patch.queryParams, []);
});

test('formula and assertions get defaults', () => {
  const input = scratchDraftToRunInput({ method: 'GET', url: '' });
  assert.equal(input.formula, '');
  assert.deepEqual(input.assertions, []);

  const patch = scratchDraftToServerPatch({ bodyType: 'NONE' });
  assert.equal(patch.formula, '');
  assert.deepEqual(patch.assertions, []);
});

test('run input passes bodyParts through untouched', () => {
  const parts = [
    { id: 'p1', key: 'note', enabled: true, kind: 'text', value: 'hi' },
    { id: 'p2', key: 'f', enabled: true, kind: 'file', fileName: 'a.bin', data: 'AAEC' },
  ];
  const input = scratchDraftToRunInput({
    method: 'POST',
    url: 'https://x.test',
    bodyType: 'MULTIPART',
    bodyParts: parts,
  });
  assert.equal(input.bodyType, 'MULTIPART');
  assert.deepEqual(input.bodyParts, parts);
  assert.equal(input.bodyParts[1].data, 'AAEC');
});

test('run input defaults bodyParts to [] when absent', () => {
  const input = scratchDraftToRunInput({ method: 'POST', url: 'https://x.test', bodyType: 'MULTIPART' });
  assert.deepEqual(input.bodyParts, []);
});

test('server patch sends bodyParts (data stripped) for MULTIPART with null bodyJson/bodyText', () => {
  const patch = scratchDraftToServerPatch({
    bodyType: 'MULTIPART',
    bodyJson: 'not used',
    bodyText: 'k=v',
    bodyParts: [
      { id: 'p1', key: 'note', enabled: true, kind: 'text', value: 'hi' },
      { id: 'p2', key: 'f', enabled: true, kind: 'file', fileName: 'a.bin', fileType: 'application/octet-stream', fileSize: 3, data: 'AAEC' },
    ],
    headers: [],
    queryParams: [],
    formula: '',
    assertions: [],
  });
  assert.equal(patch.bodyType, 'MULTIPART');
  assert.deepEqual(patch.bodyParts, [
    { id: 'p1', key: 'note', enabled: true, kind: 'text', value: 'hi' },
    { id: 'p2', key: 'f', enabled: true, kind: 'file', fileName: 'a.bin', fileType: 'application/octet-stream', fileSize: 3 },
  ]);
  assert.equal(patch.bodyParts[1].data, undefined);
  assert.equal(patch.bodyJson, null);
  assert.equal(patch.bodyText, null);
});

test('server patch defaults MULTIPART bodyParts to [] when absent', () => {
  const patch = scratchDraftToServerPatch({
    bodyType: 'MULTIPART',
    headers: [],
    queryParams: [],
    formula: '',
    assertions: [],
  });
  assert.deepEqual(patch.bodyParts, []);
  assert.equal(patch.bodyJson, null);
  assert.equal(patch.bodyText, null);
});

test('server patch leaves JSON bodies unchanged (no bodyParts key)', () => {
  const patch = scratchDraftToServerPatch({
    bodyType: 'JSON',
    bodyJson: '{"a":1}',
    headers: [],
    queryParams: [],
    formula: '',
    assertions: [],
  });
  assert.deepEqual(patch.bodyJson, { a: 1 });
  assert.equal(patch.bodyText, undefined);
  assert.equal(patch.bodyParts, undefined);
});
