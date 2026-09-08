'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  paint,
  makePainter,
  stripAnsi,
  visibleLength,
  padEnd,
  elide,
  renderTable,
  statusColor,
  friendlyBytes,
} = require('../lib/format');

test('paint returns plain text when useColor is false', () => {
  assert.strictEqual(paint('ok', 'green', false), 'ok');
});

test('paint wraps with ANSI codes when useColor is true', () => {
  assert.strictEqual(paint('ok', 'green', true), '\x1b[32mok\x1b[0m');
});

test('makePainter helpers respect the flag', () => {
  const p = makePainter(true);
  assert.strictEqual(p.red('x'), '\x1b[31mx\x1b[0m');
  const plain = makePainter(false);
  assert.strictEqual(plain.green('x'), 'x');
});

test('stripAnsi removes escape sequences', () => {
  assert.strictEqual(stripAnsi('\x1b[32mhello\x1b[0m'), 'hello');
});

test('visibleLength ignores ANSI codes', () => {
  assert.strictEqual(visibleLength('\x1b[31mx\x1b[0m'), 1);
  assert.strictEqual(visibleLength('abcd'), 4);
});

test('padEnd pads to the visible width', () => {
  assert.strictEqual(padEnd('ab', 4), 'ab  ');
  assert.strictEqual(padEnd('\x1b[31mab\x1b[0m', 4), '\x1b[31mab\x1b[0m  ');
  assert.strictEqual(padEnd('abcdef', 4), 'abcdef');
});

test('elide truncates long values with a marker', () => {
  assert.strictEqual(elide('short', 20), 'short');
  const out = elide('a'.repeat(50), 10);
  assert.ok(out.length < 20);
  assert.ok(out.endsWith('…'));
});

test('elide collapses whitespace', () => {
  assert.strictEqual(elide('  hello    world ', 100), 'hello world');
});

test('renderTable aligns columns and honors a header', () => {
  const out = renderTable(
    [
      ['a', 'longer'],
      ['zzzz', 'b'],
    ],
    { header: ['ID', 'NAME'] }
  );
  const lines = out.split('\n');
  assert.strictEqual(lines[0], 'ID    NAME');
  assert.strictEqual(lines[1], '----  ------');
  assert.strictEqual(lines[2], 'a     longer');
  assert.strictEqual(lines[3], 'zzzz  b');
});

test('renderTable works without a header', () => {
  const out = renderTable([['x', 'y']]);
  assert.strictEqual(out, 'x  y');
});

test('renderTable returns empty for no rows', () => {
  assert.strictEqual(renderTable([]), '');
});

test('statusColor maps statuses to colours', () => {
  assert.strictEqual(statusColor('SUCCESS'), 'green');
  assert.strictEqual(statusColor('PASSED'), 'green');
  assert.strictEqual(statusColor('FAILED'), 'red');
  assert.strictEqual(statusColor('PENDING'), 'yellow');
});

test('friendlyBytes formats sizes', () => {
  assert.strictEqual(friendlyBytes(500), '500 B');
  assert.strictEqual(friendlyBytes(2048), '2.0 KB');
  assert.strictEqual(friendlyBytes(undefined), '?');
});
