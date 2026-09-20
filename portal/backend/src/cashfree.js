'use strict';

// ---------------------------------------------------------------------------
// Portal A — Cashfree Payments service (real gateway).
//
// A thin, dependency-free wrapper over the Cashfree PG REST API. Kept separate
// from the route handlers (controller) so the HTTP surface stays declarative
// and the provider specifics (auth headers, endpoints, webhook signature) live
// in one place — mirroring how `paymentFinalize.js` owns settlement.
//
// Configuration (all via env; never hard-coded):
//   CASHFREE_APP_ID      x-client-id
//   CASHFREE_SECRET_KEY  x-client-secret (also the webhook HMAC key)
//   CASHFREE_ENV         'sandbox' (default) | 'production'
//   CASHFREE_API_VERSION default '2023-08-01'
//   PORTAL_APP_URL       public portal base URL used to build return_url
//
// When the keys are absent `isConfigured()` is false and routes answer 503, so
// the app keeps working (simulated gateway) until the operator configures it.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const SANDBOX_BASE = 'https://sandbox.cashfree.com/pg';
const PRODUCTION_BASE = 'https://api.cashfree.com/pg';
const DEFAULT_API_VERSION = '2023-08-01';
const DEFAULT_PORTAL_URL = 'https://mockshift-portal.keerainnovations.com';

// Injectable fetch so tests can stub the provider without network access
// (mirrors email.setTransportForTest).
let transport = null;
function setTransportForTest(fn) {
  transport = fn;
}
function resetTransportForTest() {
  transport = null;
}
function doFetch(...args) {
  return (transport || fetch)(...args);
}

function appId() {
  return String(process.env.CASHFREE_APP_ID || '').trim();
}

function secretKey() {
  return String(process.env.CASHFREE_SECRET_KEY || '').trim();
}

function mode() {
  const value = String(process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
  return value === 'production' || value === 'prod' ? 'production' : 'sandbox';
}

function apiBase() {
  return mode() === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

function apiVersion() {
  return String(process.env.CASHFREE_API_VERSION || DEFAULT_API_VERSION).trim();
}

function isConfigured() {
  return Boolean(appId() && secretKey());
}

function portalUrl() {
  return String(process.env.PORTAL_APP_URL || DEFAULT_PORTAL_URL).replace(/\/+$/, '');
}

// Where Cashfree sends the browser after checkout (and appends ?order_id=...).
function returnUrl(orderId) {
  return `${portalUrl()}/pay/return?orderId=${encodeURIComponent(orderId)}`;
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-client-id': appId(),
    'x-client-secret': secretKey(),
    'x-api-version': apiVersion(),
  };
}

async function request(method, path, body, timeoutMs = 15000) {
  if (!isConfigured()) {
    const err = new Error('Payment gateway is not configured');
    err.status = 503;
    err.code = 'gateway_not_configured';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(`${apiBase()}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const message =
        (json && (json.message || json.error_description || json.error)) ||
        `Cashfree request failed (HTTP ${res.status})`;
      const err = new Error(message);
      err.status = 502;
      err.code = 'gateway_error';
      err.gatewayStatus = res.status;
      err.gateway = json;
      throw err;
    }
    return json;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error('Payment gateway timed out');
      e.status = 504;
      e.code = 'gateway_timeout';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create a Cashfree order and return its hosted-checkout session.
 * @returns {Promise<{cf_order_id: string, payment_session_id: string, order_status: string}>}
 */
function createOrder({ orderId, amount, currency, customer, note }) {
  const body = {
    order_id: orderId,
    order_amount: Number(amount),
    order_currency: String(currency || 'INR').toUpperCase(),
    customer_details: {
      customer_id: String(customer.id),
      customer_name: customer.name || undefined,
      customer_email: customer.email,
      // Cashfree requires a phone; we don't collect one, so use the sandbox
      // placeholder. Replace when a phone field is added to checkout.
      customer_phone: customer.phone || '9999999999',
    },
    order_meta: { return_url: returnUrl(orderId) },
    order_note: note || undefined,
  };
  return request('POST', '/orders', body);
}

function fetchOrder(cfOrderId) {
  return request('GET', `/orders/${encodeURIComponent(cfOrderId)}`);
}

function fetchOrderPayments(cfOrderId) {
  return request('GET', `/orders/${encodeURIComponent(cfOrderId)}/payments`);
}

// Cashfree order/payment statuses that mean "money captured".
function isPaidStatus(status) {
  return ['PAID', 'SUCCESS', 'SUCCEEDED', 'CAPTURED', 'COMPLETED'].includes(
    String(status || '').toUpperCase()
  );
}

// Cashfree signs webhooks with HMAC-SHA256(base64) over `timestamp + rawBody`
// using the client secret. Returns false (never throws) on any malformed input.
function verifyWebhookSignature({ rawBody, timestamp, signature }) {
  if (!secretKey() || !rawBody || !timestamp || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secretKey())
    .update(`${timestamp}${rawBody}`)
    .digest('base64');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isConfigured,
  mode,
  apiBase,
  apiVersion,
  portalUrl,
  returnUrl,
  createOrder,
  fetchOrder,
  fetchOrderPayments,
  isPaidStatus,
  verifyWebhookSignature,
  setTransportForTest,
  resetTransportForTest,
};
