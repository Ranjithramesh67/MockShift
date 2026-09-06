'use strict';

// Portal A (A5): subscriber self-service ("My subscription"). Session-scoped
// (NOT portal RBAC — checkout-created customers are global EDITOR, which B1
// deliberately keeps out of the portal, so nothing here calls
// requirePortalRole). All reads/mutations are owner-only through the same
// app.current_user_id() identity the B3/A4 code uses.
//
//  - GET  /overview            current subscription + invoice history + account
//  - POST /cancel              schedule cancellation at the end of the paid
//                              period (cancel_at_period_end=true)
//  - POST /reactivate          undo a scheduled cancellation
//
// Plan changes are NOT an endpoint: the customer picks a target plan and pays
// through the normal A4 checkout; confirming that order supersedes (cancels
// immediately) any other ACTIVE/TRIALING subscription via
// app.supersede_subscriptions() (see migration 017).

const { Router } = require('express');
const { query, access } = require('../shared');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const SUB_COLUMNS = `s.id, s.status, s.billing_cycle, s.current_period_start,
  s.current_period_end, s.trial_ends_at, s.cancel_at_period_end, s.cancelled_at,
  s.created_at, p.id AS plan_id, p.key AS plan_key, p.name AS plan_name,
  p.currency AS plan_currency`;

function toSubscriptionShape(r) {
  return {
    id: r.id,
    status: r.status,
    billing_cycle: r.billing_cycle,
    plan: { id: r.plan_id, key: r.plan_key, name: r.plan_name, currency: r.plan_currency },
    current_period_start: r.current_period_start,
    current_period_end: r.current_period_end,
    trial_ends_at: r.trial_ends_at,
    cancel_at_period_end: r.cancel_at_period_end,
    cancelled_at: r.cancelled_at,
    created_at: r.created_at,
  };
}

function toInvoiceShape(r) {
  return {
    id: r.id,
    number: r.number,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    order_id: r.order_id,
    billing_cycle: r.billing_cycle,
    plan_key: r.plan_key,
    plan_name: r.plan_name,
    issued_at: r.issued_at,
    paid_at: r.paid_at,
    created_at: r.created_at,
  };
}

// ------------------------------------------------------------------ Overview
// Current subscription = the newest non-terminal row (ACTIVE/TRIALING first,
// then PAST_DUE/SUSPENDED), else null. Invoice history is newest-first.
router.get('/overview', access.requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: userRows } = await query(
      `SELECT id, name, email, role, created_at FROM users WHERE id = $1`,
      [userId],
      { userId }
    );
    const user = userRows[0];
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { rows: subRows } = await query(
      `SELECT ${SUB_COLUMNS}
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1
          AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'SUSPENDED')
        ORDER BY (s.status IN ('ACTIVE', 'TRIALING')) DESC, s.created_at DESC
        LIMIT 1`,
      [userId],
      { userId }
    );
    const current = subRows[0] ? toSubscriptionShape(subRows[0]) : null;

    const { rows: invoiceRows } = await query(
      `SELECT i.id, i.number, i.amount::text AS amount, i.currency, i.status,
              i.issued_at, i.paid_at, i.created_at,
              o.id AS order_id, o.billing_cycle,
              p.key AS plan_key, p.name AS plan_name
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
         JOIN plans p ON p.id = o.plan_id
        WHERE i.user_id = $1
        ORDER BY i.created_at DESC, i.number DESC`,
      [userId],
      { userId }
    );

    const { rows: paid } = await query(
      `SELECT 1 FROM orders WHERE user_id = $1 AND status = 'PAID' AND amount > 0 LIMIT 1`,
      [userId],
      { userId }
    );

    res.json({
      ok: true,
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      current,
      invoices: invoiceRows.map(toInvoiceShape),
      hasPaidOrders: paid.length > 0,
    });
  } catch (err) {
    next(err);
  }
});

// Load the caller's own subscription row + validate state, returning friendly
// 404/409s before the SECURITY DEFINER function re-checks ownership and
// audits. `allow` maps the states that may act.
async function ownSubscription(req, res, allowStates, alreadyFlagged, notFlagged) {
  const { subscriptionId } = req.body || {};
  if (!isUuid(subscriptionId || '')) {
    res.status(400).json({ error: 'subscriptionId is required' });
    return null;
  }
  const { rows } = await query(
    `SELECT id, user_id, status, cancel_at_period_end, current_period_end
       FROM subscriptions WHERE id = $1`,
    [subscriptionId],
    { userId: req.user.id }
  );
  const sub = rows[0];
  if (!sub) {
    res.status(404).json({ error: 'Subscription not found' });
    return null;
  }
  if (sub.user_id !== req.user.id) {
    res.status(403).json({ error: 'Not your subscription' });
    return null;
  }
  if (!allowStates.includes(sub.status)) {
    res.status(409).json({ error: `A ${sub.status.toLowerCase()} subscription cannot be changed` });
    return null;
  }
  if (alreadyFlagged && sub.cancel_at_period_end) {
    res.status(409).json({ error: 'This subscription is already scheduled to cancel at the end of its period' });
    return null;
  }
  if (notFlagged && !sub.cancel_at_period_end) {
    res.status(409).json({ error: 'This subscription is not scheduled to cancel' });
    return null;
  }
  return sub;
}

// ---------------------------------------------------------------- Cancel
// POST { subscriptionId } — schedule cancellation at period end.
router.post('/cancel', access.requireAuth, async (req, res, next) => {
  try {
    const sub = await ownSubscription(req, res, ['ACTIVE', 'TRIALING'], true, false);
    if (!sub) return;

    await query('SELECT app.self_service_cancel_subscription($1)', [sub.id], {
      userId: req.user.id,
    });
    const { rows } = await query(
      `SELECT ${SUB_COLUMNS}
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.id = $1`,
      [sub.id],
      { userId: req.user.id }
    );
    res.json({ ok: true, subscription: toSubscriptionShape(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- Reactivate
// POST { subscriptionId } — undo a scheduled cancellation.
router.post('/reactivate', access.requireAuth, async (req, res, next) => {
  try {
    const sub = await ownSubscription(req, res, ['ACTIVE', 'TRIALING'], false, true);
    if (!sub) return;

    await query('SELECT app.self_service_reactivate_subscription($1)', [sub.id], {
      userId: req.user.id,
    });
    const { rows } = await query(
      `SELECT ${SUB_COLUMNS}
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.id = $1`,
      [sub.id],
      { userId: req.user.id }
    );
    res.json({ ok: true, subscription: toSubscriptionShape(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
