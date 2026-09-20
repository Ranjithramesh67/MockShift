'use strict';

// ---------------------------------------------------------------------------
// Payment login gate (real Cashfree gateway).
//
// A customer whose account was provisioned through checkout but whose paid
// order is still PENDING (and who holds no ACTIVE/TRIALING subscription yet) is
// not allowed to use the product: login is refused with 402 `payment_required`
// and every authenticated app request is refused the same way until the
// gateway confirms the payment (which creates the ACTIVE subscription).
//
// Safety rules:
//   - Platform ADMINs are never gated (avoids locking out the operator).
//   - Accounts with no paid PENDING order are never gated, so existing users
//     and admin-created accounts keep working.
//   - The gate is disabled wholesale when portal_settings.payment_gate_required
//     is false.
//   - A small allowlist keeps the account/payment endpoints reachable so a
//     blocked customer can still pay (and the webhook can always be received).
// ---------------------------------------------------------------------------

const { query } = require('./db');

const PAYMENT_PENDING_CODE = 'payment_required';

// Paths a payment-blocked user must still reach: identity, checkout, the
// gateway session/status, order reads, account (invoice/pay) and webhooks.
const UNPAID_ALLOWED_PREFIXES = ['/api/auth', '/api/public', '/api/me', '/api/health'];

function isUnpaidAllowedPath(req) {
  const url = String((req && (req.originalUrl || req.url)) || '').split('?')[0];
  return UNPAID_ALLOWED_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`));
}

async function paymentGateEnabled() {
  const { rows } = await query(
    'SELECT payment_gate_required FROM portal_settings ORDER BY id LIMIT 1'
  );
  if (rows.length === 0) return true;
  return rows[0].payment_gate_required !== false;
}

/**
 * The blocking pending order for a user, or null when the user may proceed.
 * `user` is the row from access.loadUserById (needs id + role). The master
 * switch is folded into the same query so the hot path costs one lookup.
 */
async function pendingPaymentFor(user) {
  if (!user || !user.id) return null;
  if (user.role === 'ADMIN') return null;
  const { rows } = await query(
    `SELECT o.id, o.amount::text AS amount, o.currency, o.billing_cycle,
            p.key AS plan_key, p.name AS plan_name
       FROM orders o
       JOIN plans p ON p.id = o.plan_id
      WHERE o.user_id = $1
        AND o.status = 'PENDING'
        AND o.amount > 0
        AND COALESCE((SELECT ps.payment_gate_required FROM portal_settings ps ORDER BY ps.id LIMIT 1), true)
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
           WHERE s.user_id = $1 AND s.status IN ('ACTIVE', 'TRIALING')
        )
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [user.id]
  );
  return rows[0] || null;
}

function paymentRequiredBody(pending) {
  const plan = pending.plan_name ? `${pending.plan_name} plan` : 'subscription';
  return {
    error: `Payment required — complete your ${plan} payment to access your account.`,
    code: PAYMENT_PENDING_CODE,
    order_id: pending.id,
    plan_key: pending.plan_key,
    plan_name: pending.plan_name,
    amount: pending.amount,
    currency: pending.currency,
    billing_cycle: pending.billing_cycle,
    checkout_url: '/checkout',
    portal_path: `/pay?orderId=${encodeURIComponent(pending.id)}`,
  };
}

module.exports = {
  PAYMENT_PENDING_CODE,
  isUnpaidAllowedPath,
  paymentGateEnabled,
  pendingPaymentFor,
  paymentRequiredBody,
};
