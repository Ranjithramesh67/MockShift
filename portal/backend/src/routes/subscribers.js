'use strict';

// Portal B (B3): subscriber directory + subscription/order/invoice lifecycle.
// server.js mounts this router only at /api/subscribers, so the lifecycle
// actions from CONTRACT.md live beneath it as /subscriptions/...,
// /orders/... and /invoices/... sub-routes. Response shapes match CONTRACT.md.

const { Router } = require('express');
const { pool, query } = require('../shared');
const { access, roleAtLeast, requirePortalRole } = require('../portalAccess');
const { logAudit } = require('../auditLog');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUB_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'];
const LIST_STATUSES = [...SUB_STATUSES, 'NONE'];
const CYCLES = ['MONTHLY', 'YEARLY', 'CUSTOM'];

// Base: any portal role (VIEWER+). Mutations stack MANAGER/ADMIN per route.
router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Detail-shape subscription row (plan embedded), used by GET :userId and by
// every lifecycle response (`subscription` key per CONTRACT.md).
const SUB_COLUMNS = `s.id, s.status, s.billing_cycle,
  s.current_period_start, s.current_period_end, s.trial_ends_at,
  s.cancel_at_period_end, s.cancelled_at, s.created_at,
  p.id AS plan_id, p.key AS plan_key, p.name AS plan_name, p.currency AS plan_currency`;

function toSubscriptionShape(r) {
  return {
    id: r.id,
    status: r.status,
    billing_cycle: r.billing_cycle,
    plan: {
      id: r.plan_id,
      key: r.plan_key,
      name: r.plan_name,
      currency: r.plan_currency,
    },
    current_period_start: r.current_period_start,
    current_period_end: r.current_period_end,
    trial_ends_at: r.trial_ends_at,
    cancel_at_period_end: r.cancel_at_period_end,
    cancelled_at: r.cancelled_at,
    created_at: r.created_at,
  };
}

async function fetchSubscription(id, options) {
  const { rows } = await query(
    `SELECT ${SUB_COLUMNS}
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.id = $1`,
    [id],
    options
  );
  return rows[0] ? toSubscriptionShape(rows[0]) : null;
}

function toOrderShape(r) {
  return {
    id: r.id,
    plan_key: r.plan_key,
    plan_name: r.plan_name,
    billing_cycle: r.billing_cycle,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    payment_method: r.payment_method,
    created_at: r.created_at,
  };
}

async function fetchOrder(id) {
  const { rows } = await query(
    `SELECT o.id, p.key AS plan_key, p.name AS plan_name, o.billing_cycle,
            o.amount::text AS amount, o.currency, o.status, o.payment_method,
            o.created_at
       FROM orders o
       JOIN plans p ON p.id = o.plan_id
      WHERE o.id = $1`,
    [id]
  );
  return rows[0] ? toOrderShape(rows[0]) : null;
}

async function fetchInvoice(id) {
  const { rows } = await query(
    `SELECT i.id, i.number, i.amount::text AS amount, i.currency, i.status,
            i.issued_at, i.paid_at
       FROM invoices i
      WHERE i.id = $1`,
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    number: r.number,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    issued_at: r.issued_at,
    paid_at: r.paid_at,
  };
}

// Run `fn(client)` inside a transaction with the session user context set
// (same scheme as shared.query). Used for multi-statement mutations (refund).
async function withTransaction(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function parsePaging(query) {
  const page = Number.parseInt(String(query.page ?? ''), 10);
  const pageSize = Number.parseInt(String(query.pageSize ?? ''), 10);
  const safePage = Number.isFinite(page) && page >= 1 ? page : 1;
  const rawSize = Number.isFinite(pageSize) && pageSize >= 1 ? pageSize : 20;
  return { page: safePage, pageSize: Math.min(100, rawSize) };
}

/* ------------------------------------------------------------- List users */

// GET /api/subscribers — every user that has at least one subscription (the
// demo "subscriber" universe). `status=NONE` (explicit filter) flips that to
// users with no subscription at all. VIEWER gets `email: null` (no PII).
router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePaging(req.query);
    const where = [];
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const search = String(req.query.search || '').trim();
    if (search) {
      const like = addParam(`${search}%`);
      where.push(`(u.name ILIKE ${like} OR u.email ILIKE ${like} OR u.username ILIKE ${like})`);
    }

    const status = String(req.query.status || '').toUpperCase();
    if (status) {
      if (!LIST_STATUSES.includes(status)) {
        return res.status(400).json({
          error: `status must be one of ${LIST_STATUSES.join('/')}`,
        });
      }
      if (status === 'NONE') {
        where.push(`NOT EXISTS (SELECT 1 FROM subscriptions ss WHERE ss.user_id = u.id)`);
      } else {
        where.push(`l.status = ${addParam(status)}`);
      }
    } else {
      where.push(`EXISTS (SELECT 1 FROM subscriptions ss WHERE ss.user_id = u.id)`);
    }

    if (req.query.planId !== undefined && req.query.planId !== '') {
      const planId = String(req.query.planId);
      if (!isUuid(planId)) {
        return res.status(400).json({ error: 'planId must be a valid id' });
      }
      where.push(`l.plan_id = ${addParam(planId)}`);
    }

    const whereSql = where.join(' AND ');
    const fromSql = `
      FROM users u
      LEFT JOIN LATERAL (
        SELECT s.id, s.plan_id, s.status, s.billing_cycle,
               s.current_period_start, s.current_period_end, s.trial_ends_at,
               s.cancel_at_period_end, s.created_at
          FROM subscriptions s
         WHERE s.user_id = u.id
         ORDER BY s.created_at DESC
         LIMIT 1
      ) l ON true
      LEFT JOIN plans p ON p.id = l.plan_id`;

    const { rows: countRows } = await query(
      `SELECT count(*)::int AS total ${fromSql} WHERE ${whereSql}`,
      params,
      { userId: req.user.id }
    );

    const { rows } = await query(
      `SELECT u.id, u.name, u.email,
              l.id AS sub_id, l.plan_id, l.status, l.billing_cycle,
              l.current_period_start, l.current_period_end, l.trial_ends_at,
              l.cancel_at_period_end, l.created_at,
              p.key AS plan_key, p.name AS plan_name,
              (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id) AS total_orders,
              (SELECT coalesce(sum(o2.amount) FILTER (WHERE o2.status = 'PAID'), 0)::text
                 FROM orders o2 WHERE o2.user_id = u.id) AS total_paid
        ${fromSql}
       WHERE ${whereSql}
       ORDER BY u.name ASC, u.id
       LIMIT ${addParam(pageSize)} OFFSET ${addParam((page - 1) * pageSize)}`,
      params,
      { userId: req.user.id }
    );

    const canEmail = roleAtLeast(req.user.role, 'SUPPORT');
    const subscribers = rows.map((r) => ({
      user: { id: r.id, name: r.name, email: canEmail ? r.email : null },
      subscription: r.sub_id
        ? {
            id: r.sub_id,
            status: r.status,
            billing_cycle: r.billing_cycle,
            plan_id: r.plan_id,
            plan_key: r.plan_key,
            plan_name: r.plan_name,
            current_period_end: r.current_period_end,
            trial_ends_at: r.trial_ends_at,
            cancel_at_period_end: r.cancel_at_period_end,
          }
        : null,
      totalOrders: r.total_orders,
      totalPaid: r.total_paid,
    }));

    res.json({ total: countRows[0].total, page, pageSize, subscribers });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------- Detail */

// GET /api/subscribers/:userId — SUPPORT+; full user + subscriptions/orders/invoices.
router.get('/:userId', requirePortalRole('SUPPORT'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.userId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { rows: userRows } = await query(
      `SELECT id, name, email, username, role, is_active, created_at
         FROM users WHERE id = $1`,
      [req.params.userId],
      { userId: req.user.id }
    );
    if (!userRows[0]) return res.status(404).json({ error: 'User not found' });

    const { rows: subRows } = await query(
      `SELECT ${SUB_COLUMNS}
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1
        ORDER BY s.created_at DESC`,
      [req.params.userId],
      { userId: req.user.id }
    );
    const { rows: orderRows } = await query(
      `SELECT o.id, p.key AS plan_key, p.name AS plan_name, o.billing_cycle,
              o.amount::text AS amount, o.currency, o.status, o.payment_method,
              o.created_at
         FROM orders o
         JOIN plans p ON p.id = o.plan_id
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC`,
      [req.params.userId],
      { userId: req.user.id }
    );
    const { rows: invoiceRows } = await query(
      `SELECT i.id, i.number, i.amount::text AS amount, i.currency, i.status,
              i.issued_at, i.paid_at
         FROM invoices i
        WHERE i.user_id = $1
        ORDER BY i.created_at DESC`,
      [req.params.userId],
      { userId: req.user.id }
    );

    res.json({
      user: userRows[0],
      subscriptions: subRows.map(toSubscriptionShape),
      orders: orderRows.map(toOrderShape),
      invoices: invoiceRows.map((r) => ({
        id: r.id,
        number: r.number,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        issued_at: r.issued_at,
        paid_at: r.paid_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------- Subscription lifecycle (MANAGER+) */

router.post(
  '/subscriptions/:id/activate',
  requirePortalRole('MANAGER'),
  async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      const before = await fetchSubscription(req.params.id, { userId: req.user.id });
      if (!before) return res.status(404).json({ error: 'Subscription not found' });
      if (before.status === 'ACTIVE') {
        return res.status(409).json({ error: 'Subscription is already active' });
      }
      await query(
        `UPDATE subscriptions
            SET status = 'ACTIVE', cancel_at_period_end = false,
                cancelled_at = NULL, current_period_start = now(),
                updated_at = now()
          WHERE id = $1`,
        [req.params.id],
        { userId: req.user.id }
      );
      await logAudit(req, {
        action: 'subscriptions.activate',
        targetType: 'subscription',
        targetId: req.params.id,
        targetRef: before.plan.key,
        before: { status: before.status },
        after: { status: 'ACTIVE' },
      });
      const subscription = await fetchSubscription(req.params.id, { userId: req.user.id });
      res.json({ ok: true, subscription });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/subscriptions/:id/suspend',
  requirePortalRole('MANAGER'),
  async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      const before = await fetchSubscription(req.params.id, { userId: req.user.id });
      if (!before) return res.status(404).json({ error: 'Subscription not found' });
      if (before.status === 'SUSPENDED' || before.status === 'CANCELLED') {
        return res.status(409).json({
          error: `Cannot suspend a ${before.status.toLowerCase()} subscription`,
        });
      }
      await query(
        `UPDATE subscriptions SET status = 'SUSPENDED', updated_at = now()
          WHERE id = $1`,
        [req.params.id],
        { userId: req.user.id }
      );
      await logAudit(req, {
        action: 'subscriptions.suspend',
        targetType: 'subscription',
        targetId: req.params.id,
        targetRef: before.plan.key,
        before: { status: before.status },
        after: { status: 'SUSPENDED' },
      });
      const subscription = await fetchSubscription(req.params.id, { userId: req.user.id });
      res.json({ ok: true, subscription });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/subscriptions/:id/cancel',
  requirePortalRole('MANAGER'),
  async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      const before = await fetchSubscription(req.params.id, { userId: req.user.id });
      if (!before) return res.status(404).json({ error: 'Subscription not found' });
      if (before.status === 'CANCELLED') {
        return res.status(409).json({ error: 'Subscription is already cancelled' });
      }
      await query(
        `UPDATE subscriptions
            SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
          WHERE id = $1`,
        [req.params.id],
        { userId: req.user.id }
      );
      await logAudit(req, {
        action: 'subscriptions.cancel',
        targetType: 'subscription',
        targetId: req.params.id,
        targetRef: before.plan.key,
        before: { status: before.status },
        after: { status: 'CANCELLED' },
      });
      const subscription = await fetchSubscription(req.params.id, { userId: req.user.id });
      res.json({ ok: true, subscription });
    } catch (err) {
      next(err);
    }
  }
);

// POST body { planId, billingCycle? } — billingCycle defaults to the plan's
// default (MONTHLY) per CONTRACT; when the current cycle is still supported it
// is preserved otherwise the plan default is used.
router.post(
  '/subscriptions/:id/change-plan',
  requirePortalRole('MANAGER'),
  async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      const before = await fetchSubscription(req.params.id, { userId: req.user.id });
      if (!before) return res.status(404).json({ error: 'Subscription not found' });

      const body = req.body || {};
      const errors = [];
      let planId = body.planId;
      if (planId === undefined || planId === null || planId === '') {
        errors.push('planId is required');
      } else if (!isUuid(String(planId))) {
        errors.push('planId must be a valid id');
      }
      if (body.billingCycle !== undefined && body.billingCycle !== null) {
        if (!CYCLES.includes(String(body.billingCycle).toUpperCase())) {
          errors.push(`billingCycle must be one of ${CYCLES.join('/')}`);
        }
      }
      if (errors.length) return res.status(400).json({ error: errors.join('; ') });
      planId = String(planId);

      const { rows: planRows } = await query(
        `SELECT id, key, name, billing_cycles FROM plans WHERE id = $1`,
        [planId],
        { userId: req.user.id }
      );
      const plan = planRows[0];
      if (!plan) return res.status(400).json({ error: 'Plan not found' });

      let cycle;
      if (body.billingCycle) {
        cycle = String(body.billingCycle).toUpperCase();
        if (!plan.billing_cycles.includes(cycle)) {
          return res.status(400).json({
            error: `Plan ${plan.key} does not support billing cycle ${cycle}`,
          });
        }
      } else {
        cycle = plan.billing_cycles.includes(before.billing_cycle)
          ? before.billing_cycle
          : plan.billing_cycles.includes('MONTHLY')
            ? 'MONTHLY'
            : plan.billing_cycles[0] || 'MONTHLY';
      }

      await query(
        `UPDATE subscriptions
            SET plan_id = $2, billing_cycle = $3,
                current_period_start = now(), current_period_end = NULL,
                updated_at = now()
          WHERE id = $1`,
        [req.params.id, planId, cycle],
        { userId: req.user.id }
      );
      await logAudit(req, {
        action: 'subscriptions.change_plan',
        targetType: 'subscription',
        targetId: req.params.id,
        targetRef: plan.key,
        before: {
          status: before.status,
          plan_id: before.plan.id,
          billing_cycle: before.billing_cycle,
        },
        after: {
          status: before.status,
          plan_id: planId,
          billing_cycle: cycle,
        },
      });
      const subscription = await fetchSubscription(req.params.id, { userId: req.user.id });
      res.json({ ok: true, subscription });
    } catch (err) {
      next(err);
    }
  }
);

/* ---------------------------------------------------- Order / invoice (ADMIN) */

router.post('/orders/:id/refund', requirePortalRole('ADMIN'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const before = await fetchOrder(req.params.id);
    if (!before) return res.status(404).json({ error: 'Order not found' });
    if (!['PAID', 'ISSUED'].includes(before.status)) {
      const conflict = before.status === 'REFUNDED' ? 'Order is already refunded' : `Cannot refund a ${before.status.toLowerCase()} order`;
      return res.status(409).json({ error: conflict });
    }

    await withTransaction(req.user.id, async (client) => {
      await client.query(
        `UPDATE orders SET status = 'REFUNDED' WHERE id = $1`,
        [req.params.id]
      );
      await client.query(
        `UPDATE invoices SET status = 'VOID', paid_at = NULL
          WHERE order_id = $1 AND status IN ('ISSUED', 'PAID')`,
        [req.params.id]
      );
    });
    await logAudit(req, {
      action: 'orders.refund',
      targetType: 'order',
      targetId: req.params.id,
      targetRef: before.plan_key,
      before: { status: before.status, amount: before.amount },
      after: { status: 'REFUNDED' },
    });
    const order = await fetchOrder(req.params.id);
    res.json({ ok: true, order });
  } catch (err) {
    next(err);
  }
});

router.post('/invoices/:id/void', requirePortalRole('ADMIN'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const before = await fetchInvoice(req.params.id);
    if (!before) return res.status(404).json({ error: 'Invoice not found' });
    if (before.status === 'VOID') {
      return res.status(409).json({ error: 'Invoice is already void' });
    }
    await query(
      `UPDATE invoices SET status = 'VOID', paid_at = NULL WHERE id = $1`,
      [req.params.id],
      { userId: req.user.id }
    );
    await logAudit(req, {
      action: 'invoices.void',
      targetType: 'invoice',
      targetId: req.params.id,
      targetRef: before.number,
      before: { status: before.status },
      after: { status: 'VOID' },
    });
    const invoice = await fetchInvoice(req.params.id);
    res.json({ ok: true, invoice });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
