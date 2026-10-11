'use strict';

// ---------------------------------------------------------------------------
// Portal A (A6): simulated-gateway payment finalization. Single code path
// shared by the synchronous gateway "pay" call and the provider webhook so a
// PENDING order can only ever be settled once (idempotent, race-safe):
//   1. lock the order row FOR UPDATE and re-check status,
//   2. PENDING order -> PAID (paid_at + gateway columns set),
//      DRAFT invoice -> PAID,
//   3. an ACTIVE subscription is created whose current_period_end extends by
//      the plan's first-recharge bonus (plan.trial_days) when this is the
//      customer's first paid order ever (mirrors the A4 confirm logic),
//   4. app.supersede_subscriptions() cancels any other ACTIVE/TRIALING plan so
//      one current subscription always holds,
//   5. one payment_gateway_event row is recorded inside the transaction and an
//      audit row (actor = the paying customer) is written after commit.
// ---------------------------------------------------------------------------

const { query } = require('./shared');
const { logAudit } = require('./auditLog');
const planChange = require('./planChange');
const {
  withUserTransaction,
  fetchSubscriptionShape,
  fetchSubscriptionShapeTx,
  firstRechargeBonusTx,
  toOrderShape,
  toInvoiceShape,
  ORDER_COLUMNS,
  INVOICE_COLUMNS,
} = require('./routes/publicCheckout')._helpers;

async function fetchOrderRow(orderId) {
  const { rows } = await query(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o JOIN plans p ON p.id = o.plan_id
      WHERE o.id = $1`,
    [orderId]
  );
  return rows[0] || null;
}

async function fetchInvoiceRow(orderId) {
  const { rows } = await query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE order_id = $1`, [
    orderId,
  ]);
  return rows[0] || null;
}

async function fetchSubscriptionByOrder(orderId) {
  const { rows } = await query(
    `SELECT s.id
       FROM orders o JOIN subscriptions s ON s.id = o.subscription_id
      WHERE o.id = $1`,
    [orderId]
  );
  if (!rows[0]) return null;
  return fetchSubscriptionShape(rows[0].id);
}

async function loadActor(userId) {
  const { rows } = await query('SELECT id, name, role FROM users WHERE id = $1', [userId]);
  return rows[0] || { id: userId, name: 'unknown', role: null };
}

function randomRef(prefix) {
  const hex =
    Date.now().toString(16) +
    Math.random().toString(16).slice(2, 10) +
    Math.random().toString(16).slice(2, 10);
  return `${prefix}_${hex}`;
}

// Normalise a provider "status" string to a boolean charge-success.
function isSuccessfulStatus(status) {
  return ['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'PAID', 'CAPTURED'].includes(
    String(status || '').toUpperCase()
  );
}

// ------------------------------------------------------------ finalization
// Finalize one order. `orderRow` must be the ORDER_COLUMNS join shape (has
// user_id/plan_id/amount/plan_trial_days). Throws the same 404/409/403
// semantics as the A4 confirm route for the caller to map to HTTP.
//
// Returns:
//   { alreadyProcessed: true }                                  — not PENDING
//   { finalized: true, order, invoice, subscription, bonus,
//     event: { id }, gateway: { provider, reference, paid_at } }
async function finalizePaidOrder(orderRow, { provider, eventType, reference, eventPayload = {} }) {
  const userId = orderRow.user_id;

  const providerName = String(provider || 'SIMULATED_GATEWAY');
  const providerRef = String(reference || randomRef('sim'));
  const eventTypeName = String(eventType || 'charge.succeeded');
  const settledAt = new Date().toISOString();

  const out = await withUserTransaction(userId, async (client) => {
    const { rows: lockRows } = await client.query(
      'SELECT status FROM orders WHERE id = $1 FOR UPDATE',
      [orderRow.id]
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
      [userId, orderRow.plan_id]
    );
    if (active.length > 0) {
      const err = new Error('You already have an active subscription to this plan');
      err.status = 409;
      throw err;
    }

    const bonus = await firstRechargeBonusTx(client, userId, orderRow.plan_trial_days);

    await client.query(
      `UPDATE orders
          SET status = 'PAID', gateway_status = 'SUCCEEDED',
              gateway_provider = $2, gateway_reference = $3, paid_at = now()
        WHERE id = $1`,
      [orderRow.id, providerName, providerRef]
    );
    await client.query(
      `UPDATE invoices SET status = 'PAID', issued_at = now(), paid_at = now()
        WHERE order_id = $1`,
      [orderRow.id]
    );

    // Plan-change rules: a strictly higher-priced plan activates immediately
    // (the customer was charged only the prorated difference); a same/lower
    // priced plan is queued to start when the current paid period ends.
    const decision = planChange.decisionForPaidOrder(
      await planChange.classifyPlanChange(client, {
        userId,
        cycle: orderRow.billing_cycle,
        newPrice: planChange.priceForCycle(
          { price_monthly: orderRow.plan_price_monthly, price_yearly: orderRow.plan_price_yearly },
          orderRow.billing_cycle
        ),
      })
    );

    const subscriptionId = await planChange.createSubscriptionForChange(client, {
      userId,
      planId: orderRow.plan_id,
      cycle: orderRow.billing_cycle,
      decision,
      bonusDays: bonus.days,
    });
    await client.query(`UPDATE orders SET subscription_id = $1 WHERE id = $2`, [
      subscriptionId,
      orderRow.id,
    ]);

    const payload = {
      amount: orderRow.amount,
      currency: orderRow.currency,
      plan_key: orderRow.plan_key,
      settled_at: settledAt,
      source: eventPayload.source || null,
    };
    const { rows: eventRows } = await client.query(
      `INSERT INTO payment_gateway_events
         (order_id, provider, event_type, status, payload)
       VALUES ($1, $2, $3, 'SUCCEEDED', $4)
       RETURNING id`,
      [orderRow.id, providerName, eventTypeName, JSON.stringify(payload)]
    );

    return {
      subscription: await fetchSubscriptionShapeTx(client, subscriptionId),
      eventId: eventRows[0].id,
      bonusDays: bonus.days,
      firstPaid: bonus.firstPaid,
    };
  });

  if (out.alreadyProcessed) return { alreadyProcessed: true };

  const order = toOrderShape(await fetchOrderRow(orderRow.id));
  const invoiceRow = await fetchInvoiceRow(orderRow.id);
  const invoice = invoiceRow ? toInvoiceShape(invoiceRow) : null;

  const actorUser = await loadActor(userId);
  const auditReq = { user: actorUser, ip: null };
  await logAudit(auditReq, {
    action: 'payments.order_finalized',
    targetType: 'order',
    targetId: orderRow.id,
    targetRef: `${providerName}/${orderRow.plan_key}`,
    before: {
      order: 'PENDING',
      invoice: 'DRAFT',
      gateway_status: orderRow.gateway_status || null,
    },
    after: {
      order: 'PAID',
      invoice: invoice ? invoice.status : null,
      gateway_status: 'SUCCEEDED',
      subscription_id: out.subscription.id,
    },
  });

  return {
    finalized: true,
    order,
    invoice,
    subscription: out.subscription,
    bonus: { firstRecharge: out.firstPaid, days: out.bonusDays },
    event: { id: out.eventId },
    gateway: {
      provider: providerName,
      reference: providerRef,
      paid_at: order.gateway.paid_at,
    },
  };
}

// Current state payload for an already-settled order (idempotent responses).
async function settledState(orderId) {
  const orderRow = await fetchOrderRow(orderId);
  if (!orderRow) return null;
  const invoiceRow = await fetchInvoiceRow(orderId);
  const subscription = orderRow.subscription_id ? await fetchSubscriptionByOrder(orderId) : null;
  return {
    order: toOrderShape(orderRow),
    invoice: invoiceRow ? toInvoiceShape(invoiceRow) : null,
    subscription,
  };
}

// Record a non-finalizing webhook delivery (DUPLICATE replay / FAILED charge).
async function recordGatewayEvent(orderRow, { provider, eventType, status, eventPayload = {} }) {
  const { rows } = await query(
    `INSERT INTO payment_gateway_events (order_id, provider, event_type, status, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      orderRow.id,
      String(provider || 'SIMULATED_GATEWAY'),
      String(eventType || 'charge.succeeded'),
      status,
      JSON.stringify({
        amount: orderRow.amount,
        currency: orderRow.currency,
        ...eventPayload,
      }),
    ]
  );
  return rows[0].id;
}

module.exports = {
  fetchOrderRow,
  fetchInvoiceRow,
  finalizePaidOrder,
  settledState,
  recordGatewayEvent,
  isSuccessfulStatus,
  randomRef,
};
