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
const { provisionNewAccount } = require('../../../../backend/src/api/accountProvision');
const { issueEmailVerification } = require('../../../../backend/src/api/emailVerification');
const planChange = require('../planChange');
const promoLib = require('../promo');

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
  o.amount::text AS amount, o.subtotal::text AS subtotal,
  o.discount_amount::text AS discount_amount, o.promo_code,
  o.currency, o.payment_method, o.created_at,
  o.subscription_id, o.gateway_status, o.gateway_provider, o.gateway_reference,
  o.gateway_order_id, o.gateway_session_id, o.paid_at, p.key AS plan_key,
  p.name AS plan_name, p.trial_days AS plan_trial_days,
  p.price_monthly AS plan_price_monthly, p.price_yearly AS plan_price_yearly`;

function toOrderShape(r) {
  return {
    id: r.id,
    status: r.status,
    billing_cycle: r.billing_cycle,
    amount: r.amount,
    subtotal: r.subtotal === null || r.subtotal === undefined ? r.amount : r.subtotal,
    discount_amount: r.discount_amount === null || r.discount_amount === undefined ? '0.00' : r.discount_amount,
    promo_code: r.promo_code || null,
    currency: r.currency,
    payment_method: r.payment_method,
    plan_key: r.plan_key,
    plan_name: r.plan_name,
    created_at: r.created_at,
    gateway: {
      status: r.gateway_status,
      provider: r.gateway_provider,
      reference: r.gateway_reference,
      paid_at: r.paid_at,
    },
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

// Optional session: returns the authenticated active user or null. Mirrors the
// epoch guard in access.requireAuth so a reset/change-revoked cookie is not
// accepted here either.
async function sessionUser(req) {
  const payload = authLib.verifySession(authLib.readSessionToken(req));
  if (!payload) return null;
  const { rows } = await query(
    'SELECT id, email, name, is_active, session_epoch FROM users WHERE id = $1',
    [payload.userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  if (
    typeof payload.sv === 'number' &&
    typeof user.session_epoch === 'number' &&
    payload.sv !== user.session_epoch
  ) {
    return null;
  }
  return { id: user.id, email: user.email, name: user.name };
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

// Compute the first-recharge bonus for a finalization. MUST be called inside the
// payment transaction, after the order row is locked and BEFORE the order is
// marked PAID: it takes a per-user advisory lock so two different PENDING orders
// settled concurrently cannot both observe "no prior paid order" and both grant
// the bonus (a per-order row lock alone does not serialise different orders).
async function firstRechargeBonusTx(client, userId, planTrialDays) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`order-finalize:${userId}`]);
  const { rows } = await client.query(
    `SELECT 1 FROM orders WHERE user_id = $1 AND status = 'PAID' AND amount > 0 LIMIT 1`,
    [userId]
  );
  const firstPaid = rows.length === 0;
  const days = firstPaid && Number(planTrialDays) > 0 ? Number(planTrialDays) : 0;
  return { firstPaid, days };
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
    const { planKey, billingCycle, account, promoCode } = req.body || {};
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
      const email = String((account || {}).email || '').trim().toLowerCase();
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
        const { rows: existing } = await client.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
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
        const userId = rows[0].id;
        // Give the buyer the same bootstrap the main-app register path
        // provisions (backend/src/api/accountProvision.js): a personal org for
        // consumer email addresses, or membership of the company org for a
        // business domain, plus their own "My Workspace" + Default Project —
        // so a paying customer is never left org-less.
        await provisionNewAccount(client, { userId, email, displayName });
        return userId;
      });
    }
    if (!userId) return res.status(500).json({ error: 'Could not resolve account' });

    // Activate (or retire) any plan change whose date has arrived before we
    // classify a new one against the current plan.
    await planChange.promoteScheduledSubscriptions(userId);

    const existing = await hasActiveSubscription(userId, plan.id);
    if (existing) {
      return res.status(409).json({
        error: `You already have an active ${existing.plan_name} subscription`,
        code: 'already_active',
      });
    }

    const accountSummary = {
      id: userId,
      name: accountInfo.name,
      email: accountInfo.email,
      created: accountInfo.created,
    };

    const result = await withUserTransaction(userId, async (client) => {
      // Plan-change rules: block an immediate cheaper/same-price recharge,
      // prorate upgrades, and queue a lower plan for the end of the period.
      const decision = await planChange.classifyPlanChange(client, {
        userId,
        plan,
        cycle,
        newPrice: amount,
      });

      if (decision.kind === 'BLOCKED') {
        return { kind: 'blocked', code: decision.code, message: decision.message };
      }

      const firstRechargeEligible = !(await hasPriorPaidOrder(userId, { userId }));
      const bonusDays = firstRechargeEligible && plan.trial_days > 0 ? plan.trial_days : 0;

      // Upgrades are charged only the prorated difference; everything else pays
      // the catalog price.
      const amountDue = decision.kind === 'UPGRADE' ? decision.amountDue : amount;

      // Apply an optional promo code to the amount about to be charged. The
      // promo row is locked FOR UPDATE and its use reserved here, before the
      // order is written, so a limited code cannot be oversold by concurrent
      // checkouts.
      let promo = null;
      let discount = 0;
      let subtotal = amountDue;
      let charge = amountDue;
      if (promoCode && amount > 0 && amountDue >= 1) {
        const resolved = await promoLib.resolvePromo(client, {
          code: promoCode,
          plan,
          amount: amountDue,
        });
        promo = resolved.promo;
        discount = resolved.discount;
        subtotal = resolved.base;
        charge = resolved.total;
      }

      if (amount === 0 || charge < 1) {
        // Free plan, a promo covering the whole charge, or an upgrade fully
        // covered by the unused current period — no order/invoice; activate (or
        // queue) immediately. A free activation never creates a paid order, so a
        // later paid purchase is still the customer's first recharge.
        if (promo) await promoLib.consumePromo(client, promo.id);
        const subscriptionId = await planChange.createSubscriptionForChange(client, {
          userId,
          planId: plan.id,
          cycle,
          decision,
          bonusDays,
        });
        return {
          kind: 'free',
          scheduled: decision.kind === 'DOWNGRADE',
          subscription: await fetchSubscriptionShapeTx(client, subscriptionId),
          promo: promoLib.toPromoShape(promo),
          subtotal,
          discount,
          charge,
        };
      }

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (user_id, plan_id, amount, subtotal, discount_amount,
                             promo_code_id, promo_code, currency, billing_cycle, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
         RETURNING id`,
        [
          userId,
          plan.id,
          charge,
          subtotal,
          discount,
          promo ? promo.id : null,
          promo ? promo.code : null,
          plan.currency,
          cycle,
        ]
      );
      const orderId = orderRows[0].id;

      if (promo) await promoLib.consumePromo(client, promo.id);

      const number = await nextInvoiceNumber(client);
      const { rows: invoiceRows } = await client.query(
        `INSERT INTO invoices (order_id, user_id, number, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, 'DRAFT')
         RETURNING id`,
        [orderId, userId, number, charge, plan.currency]
      );

      const { rows: orderOut } = await client.query(
        `SELECT ${ORDER_COLUMNS}
           FROM orders o JOIN plans p ON p.id = o.plan_id
          WHERE o.id = $1`,
        [orderId]
      );
      const { rows: invoiceOut } = await client.query(
        `SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id = $1`,
        [invoiceRows[0].id]
      );

      return {
        kind: 'paid',
        order: toOrderShape(orderOut[0]),
        invoice: toInvoiceShape(invoiceOut[0]),
        bonus: { firstRechargeEligible, days: bonusDays },
        promo: promoLib.toPromoShape(promo),
        planChange: {
          kind: decision.kind,
          prorated: decision.kind === 'UPGRADE',
          fullPrice: amount,
          amountDue,
          discount,
          total: charge,
        },
      };
    });

    if (result.kind === 'blocked') {
      return res.status(409).json({ error: result.message, code: result.code });
    }

    if (accountSummary.created) {
      res.setHeader('Set-Cookie', authLib.sessionCookie(authLib.createSessionToken(userId)));
      // This is the production account-creation path (self-service signup is
      // closed), so the buyer is the one who sees the "verify your email"
      // banner. Issue the link here or nobody ever gets one. Best-effort: a
      // mail hiccup must not fail a checkout that already charged.
      try {
        const sent = await issueEmailVerification(userId, accountSummary.email);
        accountSummary.emailVerification = sent && sent.skipped
          ? 'not_configured'
          : sent && sent.error
            ? 'failed'
            : 'sent';
      } catch (err) {
        accountSummary.emailVerification = 'failed';
        console.error('[checkout] verification email failed:', err && err.message);
      }
    }

    if (result.kind === 'free') {
      return res.status(201).json({
        ok: true,
        requiresPayment: false,
        scheduled: Boolean(result.scheduled),
        subscription: result.subscription,
        promo: result.promo || null,
        subtotal: result.subtotal,
        discount: result.discount,
        total: result.charge,
        account: accountSummary,
      });
    }
    return res.status(201).json({
      ok: true,
      requiresPayment: true,
      order: result.order,
      invoice: result.invoice,
      bonus: result.bonus,
      promo: result.promo || null,
      planChange: result.planChange || null,
      account: accountSummary,
    });
  } catch (err) {
    if (err && err.promoCode) {
      return res.status(err.status || 400).json({ error: err.message, code: err.promoCode });
    }
    next(err);
  }
});

// ------------------------------------------------------------------- Quote
// POST /api/public/checkout/quote — preview the amount due for a plan/cycle
// with an optional promo code, without creating an order or reserving the code.
// It runs the same plan-change classification as /checkout so the quoted total
// matches what will actually be charged (prorated upgrades included).
router.post('/checkout/quote', async (req, res, next) => {
  try {
    const { planKey, billingCycle, promoCode } = req.body || {};
    const cycle = String(billingCycle || '').toUpperCase();
    const key = String(planKey || '').trim();

    const plan = key ? await planByKey(key) : null;
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (!CYCLES.includes(cycle) || !plan.billing_cycles.includes(cycle)) {
      return res.status(400).json({ error: `billingCycle must be one of ${plan.billing_cycles.join('/')}` });
    }
    const price = cycle === 'YEARLY' ? plan.price_yearly : plan.price_monthly;
    if (price === null || price === undefined) {
      return res.status(400).json({ error: `${plan.name} uses custom pricing — contact sales for a quote` });
    }
    const amount = Number(price);

    const me = await sessionUser(req);
    const run = async (client) => {
      let decision = { kind: 'NONE' };
      if (me && amount > 0) {
        decision = await planChange.classifyPlanChange(client, {
          userId: me.id,
          plan,
          cycle,
          newPrice: amount,
        });
      }
      if (decision.kind === 'BLOCKED') {
        return { blocked: { code: decision.code, message: decision.message } };
      }
      const amountDue = decision.kind === 'UPGRADE' ? decision.amountDue : amount;
      let resolved = { promo: null, base: amountDue, discount: 0, total: amountDue };
      if (promoCode && amount > 0 && amountDue >= 1) {
        resolved = await promoLib.resolvePromo(client, { code: promoCode, plan, amount: amountDue });
      }
      return {
        promo: promoLib.toPromoShape(resolved.promo),
        base: resolved.base,
        discount: resolved.discount,
        total: resolved.total,
        planChange: {
          kind: decision.kind,
          prorated: decision.kind === 'UPGRADE',
          fullPrice: amount,
          amountDue,
        },
      };
    };
    const quote = me ? await withUserTransaction(me.id, run) : await withTransaction(run);

    if (quote.blocked) {
      return res.status(409).json({ error: quote.blocked.message, code: quote.blocked.code });
    }
    return res.json({
      ok: true,
      plan: { key: plan.key, name: plan.name, currency: plan.currency },
      billingCycle: cycle,
      base: quote.base,
      discount: quote.discount,
      total: quote.total,
      requiresPayment: quote.total >= 1,
      promo: quote.promo,
      planChange: quote.planChange,
    });
  } catch (err) {
    if (err && err.promoCode) {
      return res.status(err.status || 400).json({ error: err.message, code: err.promoCode });
    }
    next(err);
  }
});

// ------------------------------------------------------------------- Resume
// POST /api/public/checkout/resume — a customer whose account was created at
// checkout but whose paid order is still unpaid can prove ownership with their
// password and receive a session plus their PENDING order, so they can finish
// paying. Without this the login gate would lock them out with no way back to
// the payment gateway.
router.post('/checkout/resume', async (req, res, next) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    if (!EMAIL_RE.test(email) || !password) {
      return res.status(400).json({ error: 'A valid email and password are required' });
    }
    const { rows: users } = await query(
      'SELECT id, email, name, password_hash, is_active FROM users WHERE lower(email) = $1',
      [email]
    );
    const user = users[0];
    if (!user || !(await authLib.verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'This account has been deactivated' });

    const { rows: pending } = await query(
      `SELECT ${ORDER_COLUMNS}
         FROM orders o JOIN plans p ON p.id = o.plan_id
        WHERE o.user_id = $1 AND o.status = 'PENDING' AND o.amount > 0
          AND NOT EXISTS (SELECT 1 FROM subscriptions s
                           WHERE s.user_id = $1 AND s.status IN ('ACTIVE', 'TRIALING'))
        ORDER BY o.created_at DESC LIMIT 1`,
      [user.id]
    );
    const order = pending[0];
    if (!order) {
      return res.status(404).json({
        error: 'No pending payment was found for this account',
        code: 'no_pending_payment',
      });
    }

    res.setHeader('Set-Cookie', authLib.sessionCookie(authLib.createSessionToken(user.id)));
    res.json({
      ok: true,
      requiresPayment: true,
      order: toOrderShape(order),
      account: { id: user.id, name: user.name, email: user.email, created: false },
    });
  } catch (err) {
    next(err);
  }
});

// Idempotent response for an order that is already settled (PAID/terminal):
// re-reads the invoice + subscription so concurrent confirms converge.
async function settledOrderResponse(order, userId) {
  const { rows: invoiceRows } = await query(
    `SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE order_id = $1`,
    [order.id],
    { userId }
  );
  const subscription = order.subscription_id
    ? await fetchSubscriptionShape(order.subscription_id, { userId })
    : null;
  return {
    ok: true,
    alreadyProcessed: true,
    order: toOrderShape(order),
    invoice: invoiceRows[0] ? toInvoiceShape(invoiceRows[0]) : null,
    subscription,
  };
}

// ------------------------------------------------------------------- Confirm
// POST /api/public/checkout/:orderId/confirm — mock gateway success. Owner
// only. Idempotent: confirming an already-PAID order just returns the current
// state. Applies the first-recharge bonus when this is the user's first paid
// order ever.
router.post('/checkout/:orderId/confirm', access.requireAuth, async (req, res, next) => {
  try {
    // The mock confirmation flow is a demo-only shortcut (it marks an order
    // PAID with no charge). Real orders settle through the Cashfree status poll
    // / signed webhook, so this is off unless explicitly opted in.
    if (process.env.ALLOW_MOCK_GATEWAY !== '1') {
      return res.status(403).json({
        error: 'The simulated payment confirmation flow is disabled',
        code: 'mock_gateway_disabled',
      });
    }

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
      return res.json(await settledOrderResponse(order, req.user.id));
    }

    const out = await withUserTransaction(req.user.id, async (client) => {
      // Lock the order row first so two concurrent confirms cannot both pass
      // the PENDING check and create duplicate ACTIVE subscriptions.
      const { rows: lockRows } = await client.query(
        'SELECT status FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      if (lockRows.length === 0) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }
      if (lockRows[0].status !== 'PENDING') return { alreadyProcessed: true };

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

      const bonus = await firstRechargeBonusTx(client, req.user.id, order.plan_trial_days);

      await client.query(
        `UPDATE orders SET status = 'PAID' WHERE id = $1`,
        [orderId]
      );
      await client.query(
        `UPDATE invoices SET status = 'PAID', issued_at = now(), paid_at = now() WHERE order_id = $1`,
        [orderId]
      );

      // Plan-change rules apply here too (a cheaper/lateral plan confirmed
      // after a scheduled cancellation is queued, an upgrade is prorated).
      const decision = planChange.decisionForPaidOrder(
        await planChange.classifyPlanChange(client, {
          userId: req.user.id,
          cycle: order.billing_cycle,
          newPrice: planChange.priceForCycle(
            { price_monthly: order.plan_price_monthly, price_yearly: order.plan_price_yearly },
            order.billing_cycle
          ),
        })
      );

      const subscriptionId = await planChange.createSubscriptionForChange(client, {
        userId: req.user.id,
        planId: order.plan_id,
        cycle: order.billing_cycle,
        decision,
        bonusDays: bonus.days,
      });
      await client.query(`UPDATE orders SET subscription_id = $1 WHERE id = $2`, [
        subscriptionId,
        orderId,
      ]);

      return {
        subscription: await fetchSubscriptionShapeTx(client, subscriptionId),
        bonus,
      };
    });

    // Another concurrent confirm settled this order while we waited on the row
    // lock — return the settled state instead of creating a second subscription.
    if (out.alreadyProcessed) {
      const { rows: settledRows } = await query(
        `SELECT ${ORDER_COLUMNS}
           FROM orders o JOIN plans p ON p.id = o.plan_id
          WHERE o.id = $1`,
        [orderId],
        { userId: req.user.id }
      );
      return res.json(await settledOrderResponse(settledRows[0], req.user.id));
    }

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
      bonus: { firstRecharge: out.bonus.firstPaid, days: out.bonus.days },
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

// A6 (simulated gateway + webhooks) reuses the checkout shapes/transaction
// helpers so the gateway finalization stays byte-for-byte consistent with the
// A4 confirm flow. Attached to the router export (no circular dependency).
module.exports._helpers = {
  isUuid,
  withTransaction,
  withUserTransaction,
  nextInvoiceNumber,
  fetchSubscriptionShape,
  fetchSubscriptionShapeTx,
  hasActiveSubscription,
  hasPriorPaidOrder,
  firstRechargeBonusTx,
  toOrderShape,
  toInvoiceShape,
  toSubscriptionShape,
  ORDER_COLUMNS,
  INVOICE_COLUMNS,
  SUB_COLUMNS,
};
