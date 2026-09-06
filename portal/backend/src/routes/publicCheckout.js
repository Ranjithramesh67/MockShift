'use strict';

// Portal A (A4): public purchase/checkout. Runs mostly unauthenticated (a
// shopper may create their account during checkout, per the A3 decision to
// reuse `users` and auto-create on checkout, default role EDITOR). Payment is
// mocked (Q3: manual/mock invoicing first): POST /checkout holds a PENDING
// order + DRAFT invoice, then POST /checkout/:orderId/confirm simulates the
// gateway success webhook — it marks the order/invoice PAID and creates the
// ACTIVE subscription, applying the catalog's first-recharge bonus
// (`plans.trial_days`: +5/+10/+15 validity days on the customer's first paid
// order ever) by extending the paid period's end date.
//
// Free (₹0) plans skip the money plumbing: checkout activates immediately and
// never creates a paid order, so a later paid purchase still counts as the
// customer's first recharge.

const { Router } = require('express');
const { pool, query, authLib, access } = require('../shared');
const { allocateUsername } = require('../../../../backend/src/api/username');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CYCLES = ['MONTHLY', 'YEARLY'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const PLAN_COLUMNS = `id, key, name, price_monthly, price_yearly, currency,
  billing_cycles, trial_days`;

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

async function fetchSubscriptionShape(id, options) {
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

// Variant that reads on the caller's transaction client (rows inserted earlier
// in the same transaction are not visible on a separate pooled connection).
async function fetchSubscriptionShapeTx(client, id) {
  const { rows } = await client.query(
    `SELECT ${SUB_COLUMNS}
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.id = $1`,
    [id]
  );
  return rows[0] ? toSubscriptionShape(rows[0]) : null;
}

const ORDER_COLUMNS = `o.id, o.user_id, o.plan_id, o.status, o.billing_cycle,
  o.amount::text AS amount, o.currency, o.payment_method, o.created_at,
  o.subscription_id, p.key AS plan_key, p.name AS plan_name,
  p.trial_days AS plan_trial_days`;

function toOrderShape(r) {
  return {
    id: r.id,
    status: r.status,
    billing_cycle: r.billing_cycle,
    amount: r.amount,
    currency: r.currency,
    payment_method: r.payment_method,
    plan_key: r.plan_key,
    plan_name: r.plan_name,
    created_at: r.created_at,
  };
}

const INVOICE_COLUMNS = `i.id, i.number, i.amount::text AS amount, i.currency,
  i.status, i.issued_at, i.paid_at`;

function toInvoiceShape(r) {
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

// Run `fn(client)` inside a transaction with the app session set to `userId`
// (same scheme as shared.query / B3 lifecycle mutations).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

async function withUserTransaction(userId, fn) {
  return withTransaction(async (client) => {
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    return fn(client);
  });
}

// Optional session: returns the authenticated active user or null.
async function sessionUser(req) {
  const payload = authLib.verifySession(authLib.readSessionToken(req));
  if (!payload) return null;
  const { rows } = await query('SELECT id, email, name FROM users WHERE id = $1', [payload.userId]);
  const user = rows[0];
  return user ? user : null;
}

// Next invoice number for the current calendar year, e.g. INV-2026-0007.
// Called inside the writer transaction (the caller owns the lock window).
async function nextInvoiceNumber(client) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(RIGHT(number, 4) AS integer)), 0) + 1 AS next
       FROM invoices
      WHERE number LIKE $1`,
    [`INV-${year}-%`]
  );
  return `INV-${year}-${String(rows[0].next).padStart(4, '0')}`;
}

async function planByKey(key) {
  const { rows } = await query(
    `SELECT ${PLAN_COLUMNS} FROM plans WHERE key = $1 AND status = 'PUBLISHED'`,
    [key]
  );
  return rows[0] || null;
}

async function hasActiveSubscription(userId, planId) {
  const { rows } = await query(
    `SELECT s.id, p.name AS plan_name
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = $1 AND s.plan_id = $2 AND s.status IN ('ACTIVE', 'TRIALING')
      LIMIT 1`,
    [userId, planId]
  );
  return rows[0] || null;
}

// True when this user already has a paid (amount > 0) order — free ₹0 plans
// never create orders, so they never consume the first-recharge bonus.
async function hasPriorPaidOrder(userId, options) {
  const { rows } = await query(
    `SELECT 1 FROM orders WHERE user_id = $1 AND status = 'PAID' AND amount > 0 LIMIT 1`,
    [userId],
    options
  );
  return rows.length > 0;
}

// --------------------------------------------------------------------- POST
// POST /api/public/checkout
// Body: { planKey, billingCycle, account?: { name, email, password } }
//   account is required when no session is present; ignored (must match the
//   session email) when one is. Free plans return an ACTIVE subscription and
//   `requiresPayment:false`; paid plans return a PENDING order + DRAFT invoice
//   and `requiresPayment:true` (confirm via POST .../checkout/:orderId/confirm).
router.post('/checkout', async (req, res, next) => {
  try {
    const { planKey, billingCycle, account } = req.body || {};
    const cycle = String(billingCycle || '').toUpperCase();
    const key = String(planKey || '').trim();

    const plan = key ? await planByKey(key) : null;
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (!CYCLES.includes(cycle) || !plan.billing_cycles.includes(cycle)) {
      return res.status(400).json({ error: `billingCycle must be one of ${plan.billing_cycles.join('/')}` });
    }

    const price = cycle === 'YEARLY' ? plan.price_yearly : plan.price_monthly;
    if (price === null || price === undefined) {
      return res.status(400).json({
        error: `${plan.name} uses custom pricing — contact sales for a quote`,
      });
    }
    const amount = Number(price);

    // ---- Resolve identity (A3: reuse users, auto-create on checkout). ----
    const me = await sessionUser(req);
    let userId = null;
    let accountInfo = null;

    if (me) {
      if (account && account.email && String(account.email).toLowerCase() !== me.email.toLowerCase()) {
        return res.status(409).json({
          error: `Signed in as ${me.email} — sign out to purchase as a different account`,
        });
      }
      userId = me.id;
      accountInfo = { id: me.id, name: me.name, email: me.email, created: false };
    } else {
      const email = String((account || {}).email || '').trim();
      const password = String((account || {}).password || '');
      const name = String((account || {}).name || '').trim();
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const displayName = name;
      accountInfo = { email, name: displayName, created: true };

      userId = await withTransaction(async (client) => {
        const { rows: existing } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.length > 0) {
          const err = new Error('An account with that email already exists — sign in to continue');
          err.status = 409;
          throw err;
        }
        const usernameValue = await allocateUsername((sql, params) => client.query(sql, params), {
          email,
          name: displayName,
        });
        const { rows } = await client.query(
          `INSERT INTO users (email, password_hash, name, role, username)
           VALUES ($1, $2, $3, 'EDITOR', $4)
           RETURNING id, email, name`,
          [email, await authLib.hashPassword(password), displayName, usernameValue]
        );
        return rows[0].id;
      });
    }
    if (!userId) return res.status(500).json({ error: 'Could not resolve account' });

    const existing = await hasActiveSubscription(userId, plan.id);
    if (existing) {
      return res.status(409).json({
        error: `You already have an active ${existing.plan_name} subscription`,
      });
    }

    const accountSummary = {
      id: userId,
      name: accountInfo.name,
      email: accountInfo.email,
      created: accountInfo.created,
    };

    const result = await withUserTransaction(userId, async (client) => {
      if (amount === 0) {
        // Free plan — activate immediately; no order/invoice is created so a
        // later paid purchase is still the customer's first recharge.
        const { rows } = await client.query(
          `INSERT INTO subscriptions
             (user_id, plan_id, status, billing_cycle, current_period_start, current_period_end)
           VALUES ($1, $2, 'ACTIVE', $3, now(), NULL)
           RETURNING id`,
          [userId, plan.id, cycle]
        );
        return { kind: 'free', subscription: await fetchSubscriptionShapeTx(client, rows[0].id) };
      }

      const firstRechargeEligible = !(await hasPriorPaidOrder(userId, { userId }));
      const bonusDays = firstRechargeEligible && plan.trial_days > 0 ? plan.trial_days : 0;

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (user_id, plan_id, amount, currency, billing_cycle, status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING')
         RETURNING id`,
        [userId, plan.id, amount, plan.currency, cycle]
      );
      const orderId = orderRows[0].id;

      const number = await nextInvoiceNumber(client);
      const { rows: invoiceRows } = await client.query(
        `INSERT INTO invoices (order_id, user_id, number, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, 'DRAFT')
         RETURNING id`,
        [orderId, userId, number, amount, plan.currency]
      );

      const { rows: orderOut } = await client.query(
        `SELECT ${ORDER_COLUMNS}
           FROM orders o JOIN plans p ON p.id = o.plan_id
          WHERE o.id = $1`,
        [orderId]
      );
      const { rows: invoiceOut } = await client.query(
        `SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE id = $1`,
        [invoiceRows[0].id]
      );

      return {
        kind: 'paid',
        order: toOrderShape(orderOut[0]),
        invoice: toInvoiceShape(invoiceOut[0]),
        bonus: { firstRechargeEligible, days: bonusDays },
      };
    });

    if (accountSummary.created) {
      res.setHeader('Set-Cookie', authLib.sessionCookie(authLib.createSessionToken(userId)));
    }

    if (result.kind === 'free') {
      return res.status(201).json({
        ok: true,
        requiresPayment: false,
        subscription: result.subscription,
        account: accountSummary,
      });
    }
    return res.status(201).json({
      ok: true,
      requiresPayment: true,
      order: result.order,
      invoice: result.invoice,
      bonus: result.bonus,
      account: accountSummary,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------- Confirm
// POST /api/public/checkout/:orderId/confirm — mock gateway success. Owner
// only. Idempotent: confirming an already-PAID order just returns the current
// state. Applies the first-recharge bonus when this is the user's first paid
// order ever.
router.post('/checkout/:orderId/confirm', access.requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (!isUuid(orderId)) return res.status(400).json({ error: 'Invalid order id' });

    const { rows: orderRows } = await query(
      `SELECT ${ORDER_COLUMNS}
         FROM orders o JOIN plans p ON p.id = o.plan_id
        WHERE o.id = $1`,
      [orderId],
      { userId: req.user.id }
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your order' });
    }

    // Idempotent return for an already-settled order.
    if (order.status !== 'PENDING') {
      const { rows: invoiceRows } = await query(
        `SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE order_id = $1`,
        [orderId],
        { userId: req.user.id }
      );
      const subscription = order.subscription_id
        ? await fetchSubscriptionShape(order.subscription_id, { userId: req.user.id })
        : null;
      return res.json({
        ok: true,
        alreadyProcessed: true,
        order: toOrderShape(order),
        invoice: invoiceRows[0] ? toInvoiceShape(invoiceRows[0]) : null,
        subscription,
      });
    }

    const firstPaid = !(await hasPriorPaidOrder(req.user.id, { userId: req.user.id }));
    const bonusDays = firstPaid && Number(order.plan_trial_days) > 0 ? Number(order.plan_trial_days) : 0;

    const out = await withUserTransaction(req.user.id, async (client) => {
      const { rows: active } = await client.query(
        `SELECT 1 FROM subscriptions
          WHERE user_id = $1 AND plan_id = $2 AND status IN ('ACTIVE', 'TRIALING')
          LIMIT 1`,
        [req.user.id, order.plan_id]
      );
      if (active.length > 0) {
        const err = new Error('You already have an active subscription to this plan');
        err.status = 409;
        throw err;
      }

      await client.query(
        `UPDATE orders SET status = 'PAID' WHERE id = $1`,
        [orderId]
      );
      await client.query(
        `UPDATE invoices SET status = 'PAID', issued_at = now(), paid_at = now() WHERE order_id = $1`,
        [orderId]
      );

      const { rows: subRows } = await client.query(
        `INSERT INTO subscriptions
           (user_id, plan_id, status, billing_cycle, current_period_start,
            current_period_end)
         VALUES ($1, $2, 'ACTIVE', $3, now(),
                 CASE WHEN $3 = 'YEARLY'
                      THEN now() + interval '1 year' + make_interval(days => $4)
                      ELSE now() + interval '1 month' + make_interval(days => $4)
                 END)
         RETURNING id`,
        [req.user.id, order.plan_id, order.billing_cycle, bonusDays]
      );
      const subscriptionId = subRows[0].id;
      await client.query(`UPDATE orders SET subscription_id = $1 WHERE id = $2`, [
        subscriptionId,
        orderId,
      ]);

      return {
        subscription: await fetchSubscriptionShapeTx(client, subscriptionId),
      };
    });

    const { rows: orderOut } = await query(
      `SELECT ${ORDER_COLUMNS}
         FROM orders o JOIN plans p ON p.id = o.plan_id
        WHERE o.id = $1`,
      [orderId],
      { userId: req.user.id }
    );
    const { rows: invoiceOut } = await query(
      `SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE order_id = $1`,
      [orderId],
      { userId: req.user.id }
    );

    res.json({
      ok: true,
      order: toOrderShape(orderOut[0]),
      invoice: invoiceOut[0] ? toInvoiceShape(invoiceOut[0]) : null,
      subscription: out.subscription,
      bonus: { firstRecharge: firstPaid, days: bonusDays },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------- Read
// GET /api/public/orders/:orderId — owner only. Lets the confirmation page
// reload after a refresh. Returns the order (+ invoice + subscription once
// paid) and the first-recharge bonus already awarded, if any.
router.get('/orders/:orderId', access.requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (!isUuid(orderId)) return res.status(400).json({ error: 'Invalid order id' });

    const { rows: orderRows } = await query(
      `SELECT ${ORDER_COLUMNS}
         FROM orders o JOIN plans p ON p.id = o.plan_id
        WHERE o.id = $1`,
      [orderId],
      { userId: req.user.id }
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your order' });
    }

    const { rows: invoiceRows } = await query(
      `SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE order_id = $1`,
      [orderId],
      { userId: req.user.id }
    );
    const subscription = order.subscription_id
      ? await fetchSubscriptionShape(order.subscription_id, { userId: req.user.id })
      : null;

    let bonus = null;
    if (order.status === 'PENDING') {
      const { rows: prior } = await query(
        `SELECT 1 FROM orders
          WHERE user_id = $1 AND status = 'PAID' AND amount > 0 AND id <> $2
          LIMIT 1`,
        [req.user.id, orderId],
        { userId: req.user.id }
      );
      const firstPaid = prior.length === 0;
      bonus = {
        firstRechargeEligible: firstPaid,
        days: firstPaid && Number(order.plan_trial_days) > 0 ? Number(order.plan_trial_days) : 0,
      };
    }

    res.json({
      order: toOrderShape(order),
      invoice: invoiceRows[0] ? toInvoiceShape(invoiceRows[0]) : null,
      subscription,
      bonus,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
