'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  envCompletionsFor,
  envCompletionSource,
  templateTokenBefore,
} = require('../envCompletions');

test('{{ prefix suggests environment keys', () => {
  const keys = ['apiKey', 'baseUrl', 'user.id'];
  const labels = envCompletionsFor('{{api', keys).map((c) => c.label);
  assert.deepEqual(labels, ['apiKey']);
});

test('empty {{ suggests every key', () => {
  const keys = ['token', 'host'];
  const labels = envCompletionsFor('{{', keys).map((c) => c.label);
  assert.deepEqual(labels, ['token', 'host']);
});

test('completion source replaces the partial key inside braces', () => {
  const source = envCompletionSource(['apiKey', 'baseUrl']);
  const context = {
    pos: 10,
    explicit: false,
    matchBefore: (re) => {
      const text = 'https://{{api';
      const m = text.match(re);
      if (!m) return null;
      return { from: text.length - m[0].length, to: text.length, text: m[0] };
    },
  };
  const result = source(context);
  assert.ok(result);
  assert.equal(result.from, 'https://{{'.length);
  assert.ok(result.options.some((o) => o.label === 'apiKey'));
  assert.equal(result.options.find((o) => o.label === 'apiKey').apply, 'apiKey');
});

test('no {{ nearby returns null', () => {
  const source = envCompletionSource(['apiKey']);
  const context = {
    pos: 4,
    explicit: false,
    matchBefore: () => ({ from: 0, to: 4, text: 'host' }),
  };
  assert.equal(source(context), null);
});

test('templateTokenBefore extracts the open brace fragment', () => {
  assert.equal(templateTokenBefore('Bearer {{tok'), '{{tok');
  assert.equal(templateTokenBefore('nope'), null);
  assert.equal(templateTokenBefore('{{done}} extra'), null);
});
