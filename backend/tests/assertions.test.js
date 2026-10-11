'use strict';

const { evaluateAssertions, resolvePath, parseBody } = require('../src/engine/assertions');

describe('assertions engine', () => {
  const response = {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_123' },
    body: JSON.stringify({ id: 42, data: { token: 'abc' }, tags: ['a', 'b'] }),
    durationMs: 137,
  };

  test('status assertions compare numerically', () => {
    expect(
      evaluateAssertions([{ id: 's1', type: 'status', operator: 'eq', expected: '200' }], response)
    ).toEqual([{ id: 's1', passed: true, message: expect.stringContaining('actual 200') }]);
    expect(
      evaluateAssertions([{ id: 's2', type: 'status', operator: 'gt', expected: '199' }], response)
    ).toEqual([{ id: 's2', passed: true, message: expect.any(String) }]);
    expect(
      evaluateAssertions([{ id: 's3', type: 'status', operator: 'eq', expected: '201' }], response)
    ).toEqual([{ id: 's3', passed: false, message: expect.stringContaining('actual 200') }]);
  });

  test('jsonPath assertions resolve nested paths and arrays', () => {
    expect(
      evaluateAssertions([{ id: 'j1', type: 'jsonPath', operator: 'eq', path: 'id', expected: '42' }], response)
    ).toEqual([{ id: 'j1', passed: true, message: expect.stringContaining('body.id') }]);
    expect(
      evaluateAssertions([{ id: 'j2', type: 'jsonPath', operator: 'contains', path: 'data.token', expected: 'abc' }], response)
    ).toEqual([{ id: 'j2', passed: true, message: expect.any(String) }]);
    expect(
      evaluateAssertions([{ id: 'j3', type: 'jsonPath', operator: 'eq', path: 'tags.0', expected: 'a' }], response)
    ).toEqual([{ id: 'j3', passed: true, message: expect.any(String) }]);
    expect(
      evaluateAssertions([{ id: 'j4', type: 'jsonPath', operator: 'eq', path: 'missing.path', expected: 'x' }], response)
    ).toEqual([{ id: 'j4', passed: false, message: expect.stringContaining('actual undefined') }]);
  });

  test('header assertions are case-insensitive', () => {
    expect(
      evaluateAssertions([{ id: 'h1', type: 'header', operator: 'eq', path: 'X-Request-Id', expected: 'req_123' }], response)
    ).toEqual([{ id: 'h1', passed: true, message: expect.any(String) }]);
    expect(
      evaluateAssertions([{ id: 'h2', type: 'header', operator: 'contains', path: 'content-type', expected: 'json' }], response)
    ).toEqual([{ id: 'h2', passed: true, message: expect.any(String) }]);
    expect(
      evaluateAssertions([{ id: 'h3', type: 'header', operator: 'eq', path: 'x-missing', expected: 'y' }], response)
    ).toEqual([{ id: 'h3', passed: false, message: expect.stringContaining('actual undefined') }]);
  });

  test('responseTime assertions compare numerically', () => {
    expect(
      evaluateAssertions([{ id: 't1', type: 'responseTime', operator: 'lt', expected: '500' }], response)
    ).toEqual([{ id: 't1', passed: true, message: expect.stringContaining('actual 137') }]);
    expect(
      evaluateAssertions([{ id: 't2', type: 'responseTime', operator: 'gt', expected: '500' }], response)
    ).toEqual([{ id: 't2', passed: false, message: expect.stringContaining('actual 137') }]);
  });

  test('binary (base64) bodies fail jsonPath assertions gracefully', () => {
    const binary = { ...response, body: Buffer.from('not json').toString('base64'), bodyEncoding: 'base64' };
    expect(
      evaluateAssertions([{ id: 'b1', type: 'jsonPath', operator: 'eq', path: 'id', expected: '42' }], binary)
    ).toEqual([{ id: 'b1', passed: false, message: expect.stringContaining('actual undefined') }]);
  });

  test('no assertions yields an empty result', () => {
    expect(evaluateAssertions([], response)).toEqual([]);
    expect(evaluateAssertions(undefined, response)).toEqual([]);
  });

  test('helper functions', () => {
    expect(resolvePath({ a: { b: [10, 20] } }, 'a.b.1')).toBe(20);
    expect(resolvePath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(parseBody('{"x":1}')).toEqual({ x: 1 });
    expect(parseBody('not json')).toBeNull();
    expect(parseBody('cG9w', 'base64')).toBeNull();
  });
});
