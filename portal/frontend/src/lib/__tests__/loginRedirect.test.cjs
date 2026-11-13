'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { payPathFromLoginError } = require('../loginRedirect');

test('402 with portal_path sends the customer to pay (AUTH-5)', () => {
  assert.equal(
    payPathFromLoginError({
      status: 402,
      body: { portal_path: '/pay?orderId=abc', order_id: 'abc', code: 'payment_required' },
    }),
    '/pay?orderId=abc'
  );
});

test('402 with only order_id builds the pay URL', () => {
  assert.equal(
    payPathFromLoginError({ status: 402, body: { order_id: 'ord-1' } }),
    '/pay?orderId=ord-1'
  );
});

test('402 without an order falls back to pricing', () => {
  assert.equal(payPathFromLoginError({ status: 402, body: { code: 'payment_required' } }), '/#pricing');
});

test('non-402 errors do not redirect', () => {
  assert.equal(payPathFromLoginError({ status: 401, body: { error: 'Invalid email or password' } }), null);
  assert.equal(payPathFromLoginError(new Error('network')), null);
});

test('LoginView routes 402 through payPathFromLoginError', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../components/LoginView.tsx'), 'utf8');
  assert.match(source, /payPathFromLoginError/);
  assert.match(source, /router\.push\(payPath\)/);
});
