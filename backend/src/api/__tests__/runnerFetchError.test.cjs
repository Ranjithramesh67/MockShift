'use strict';

// Bug: a failed fetch surfaced only as the bare undici message "fetch failed"
// (httpStatus 0), hiding the actionable cause. describeFetchError must expose
// the underlying code/address so users can tell what actually went wrong.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeFetchError } = require('../runner');

test('surfaces ECONNREFUSED with the target address', () => {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8082'), {
    code: 'ECONNREFUSED',
    address: '127.0.0.1',
    port: 8082,
  });
  assert.equal(describeFetchError(err), 'ECONNREFUSED connecting to 127.0.0.1:8082');
});

test('surfaces ENOTFOUND (DNS failure)', () => {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND nope.invalid'), {
    code: 'ENOTFOUND',
    hostname: 'nope.invalid',
  });
  assert.equal(describeFetchError(err), 'ENOTFOUND');
});

test('unwraps an AggregateError cause (happy eyeballs)', () => {
  const a = Object.assign(new Error('connect ECONNREFUSED ::1:8082'), { code: 'ECONNREFUSED', address: '::1', port: 8082 });
  const b = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8082'), {
    code: 'ECONNREFUSED',
    address: '127.0.0.1',
    port: 8082,
  });
  const agg = new AggregateError([a, b], 'all attempts failed');
  const err = new TypeError('fetch failed');
  err.cause = agg;
  assert.equal(describeFetchError(err), 'ECONNREFUSED connecting to ::1:8082');
});

test('reports a timeout clearly', () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  assert.equal(describeFetchError(err), 'Request timed out after 15000ms');
});

test('falls back safely for unknown errors', () => {
  assert.equal(describeFetchError(null), 'Request failed');
  assert.equal(describeFetchError(new Error('boom')), 'boom');
});
