'use strict';

// ---------------------------------------------------------------------------
// Portal A — Cashfree payment controller (real gateway).
//
//   POST /api/public/gateway/cashfree/:orderId/session   (owner) create/reuse
//        the provider checkout session and hand the browser to Cashfree.
//   GET  /api/public/gateway/cashfree/:orderId/status    (owner) poll the
//        provider and settle synchronously when the webhook can't reach us.
//   POST /api/public/webhooks/cashfree                   (public, signed)
//        provider webhook: verify HMAC, then settle through the SAME
//        idempotent `finalizePaidOrder` path the simulated gateway uses.
//
// All settlement funnels through paymentFinalize so a PENDING order can only
// ever be paid once, whichever path observes it first.
// ---------------------------------------------------------------------------

const { Router } = require('express');
const { query, access } = require('../shared');
const cashfree = require('../cashfree');
const {
  isUuid,
  toOrderShape,
  toInvoiceShape,
  ORDER_COLUMNS,
  INVOICE_COLUMNS,
} = require('./publicCheckout')._helpers;
const {
  fetchOrderRow,
  finalizePaidOrder,
  settledState,
  recordGatewayEvent,
} = require('../paymentFinalize');

const gatewayRouter = Router();
const webhookRouter = Router();

// Our internal order id is the Cashfree order_id on the first attempt; a retry
// after the provider order expired can carry a short suffix (<uuid>-xxxx).
function internalOrderId(value) {
  const raw = String(value || '');
  const candidate = raw.length >= 36 ? raw.slice(0, 36) : raw;
  return isUuid(candidate) ? candidate : null;
}

// Resolve the local order from a webhook body: prefer cf_order_id (stored on
// the order), then the Cashfree order_id (our uuid, possibly suffixed) which
// may also be kept in gateway_reference on a retry.
async function resolveOrder({ cfOrderId, cashfreeOrderId }) {
  if (cfOrderId !== undefined && cfOrderId !== null && cfOrderId !== '') {
    const { rows } = await query(`SELECT ${ORDER_COLUMNS} FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.gateway_order_id = $1 LIMIT 1`, [
      String(cfOrderId),
    ]);
    if (rows[0]) return rows[0];
  }
  const id = internalOrderId(cashfreeOrderId);
  if (id) {
    const { rows } = await query(`SELECT ${ORDER_COLUMNS} FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.id = $1`, [id]);
    if (rows[0]) return rows[0];
  }
  if (cashfreeOrderId) {
    const { rows } = await query(`SELECT ${ORDER_COLUMNS} FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.gateway_reference = $1 LIMIT 1`, [
      String(cashfreeOrderId),
    ]);
    if (rows[0]) return rows[0];
  }
  return null;
}

async function loadOwnedOrder(orderId, userId) {
  const { rows } = await query(
    `SELECT ${ORDER_COLUMNS} FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.id = $1`,
    [orderId],
    { userId }
  );
  return rows[0] || null;
}

async function settledResponse(orderId) {
  const state = await settledState(orderId);
  return {
    ok: true,
    alreadyProcessed: true,
    order: state.order,
    invoice: state.invoice,
    subscription: state.subscription,
  };
}

// Settle a provider-confirmed order and shape the HTTP response. Shared by the
// session bootstrap (when Cashfree already reports PAID) and the status poll.
async function settleFromProvider(order, { source }) {
  const out = await finalizePaidOrder(order, {
    provider: 'CASHFREE',
    eventType: 'payment.success',
    reference: order.gateway_order_id ? String(order.gateway_order_id) : undefined,
    eventPayload: { source, cf_order_id: order.gateway_order_id || null },
  });
  if (out.alreadyProcessed) return settledResponse(order.id);
  const { rows: orderOut } = await query(
    `SELECT ${ORDER_COLUMNS} FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.id = $1`,
    [order.id]
  );
  const { rows: invoiceOut } = await query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.order_id = $1`, [order.id]);
  return {
    ok: true,
    order: toOrderShape(orderOut[0]),
    invoice: invoiceOut[0] ? toInvoiceShape(invoiceOut[0]) : null,
    subscription: out.subscription,
    bonus: out.bonus,
    gateway: out.gateway,
  };
}

// ---------------------------------------------------------------- Session
gatewayRouter.post('/cashfree/:orderId/session', access.requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (!isUuid(orderId)) return res.status(400).json({ error: 'Invalid order id' });

    const order = await loadOwnedOrder(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id) return res.status(403).json({ error: 'Not your order' });
    if (order.status !== 'PENDING') return res.json(await settledResponse(orderId));
    if (Number(order.amount) <= 0) {
      return res.status(400).json({ error: 'This order has no amount due — free plans activate instantly' });
    }
    if (!cashfree.isConfigured()) {
      return res.status(503).json({
        error: 'The payment gateway is not configured on this server',
        code: 'gateway_not_configured',
      });
    }

    // Already have a provider order? Reconcile before creating another.
    if (order.gateway_order_id && order.gateway_provider === 'CASHFREE') {
      const remote = await cashfree.fetchOrder(order.gateway_order_id).catch(() => null);
      if (remote && cashfree.isPaidStatus(remote.order_status)) {
        return res.json(await settleFromProvider(order, { source: 'session_reconcile' }));
      }
      if (remote && String(remote.order_status || '').toUpperCase() === 'ACTIVE' && order.gateway_session_id) {
        return res.json({
          ok: true,
          provider: 'CASHFREE',
          mode: cashfree.mode(),
          order_id: order.id,
          cf_order_id: order.gateway_order_id,
          payment_session_id: order.gateway_session_id,
          amount: order.amount,
          currency: order.currency,
          order_status: remote.order_status,
        });
      }
    }

    // First attempt uses our uuid verbatim; a retry after an expired provider
    // order uses a short suffix (Cashfree rejects duplicate order_id values).
    const cfOrderIdValue = order.gateway_order_id
      ? `${order.id}-${Date.now().toString(36)}`
      : order.id;
    const remote = await cashfree.createOrder({
      orderId: cfOrderIdValue,
      amount: order.amount,
      currency: order.currency,
      customer: { id: req.user.id, name: req.user.name, email: req.user.email },
      note: `API Hub ${order.plan_name} (${order.billing_cycle})`,
    });

    if (!remote || !remote.payment_session_id) {
      return res.status(502).json({ error: 'The payment gateway did not return a checkout session' });
    }

    await query(
      `UPDATE orders
          SET gateway_provider = 'CASHFREE',
              gateway_status = 'PENDING',
              gateway_order_id = $2,
              gateway_session_id = $3,
              gateway_reference = $4
        WHERE id = $1`,
      [order.id, String(remote.cf_order_id || ''), remote.payment_session_id, cfOrderIdValue]
    );

    res.json({
      ok: true,
      provider: 'CASHFREE',
      mode: cashfree.mode(),
      order_id: order.id,
      cf_order_id: String(remote.cf_order_id || ''),
      payment_session_id: remote.payment_session_id,
      amount: order.amount,
      currency: order.currency,
      order_status: remote.order_status || 'ACTIVE',
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- Status
gatewayRouter.get('/cashfree/:orderId/status', access.requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (!isUuid(orderId)) return res.status(400).json({ error: 'Invalid order id' });

    const order = await loadOwnedOrder(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id) return res.status(403).json({ error: 'Not your order' });
    if (order.status !== 'PENDING') return res.json(await settledResponse(orderId));

    let remoteStatus = order.gateway_status || null;
    let gatewayPayments = null;
    if (order.gateway_order_id && cashfree.isConfigured()) {
      const remote = await cashfree.fetchOrder(order.gateway_order_id).catch(() => null);
      if (remote && cashfree.isPaidStatus(remote.order_status)) {
        return res.json(await settleFromProvider(order, { source: 'status_poll' }));
      }
      if (remote && remote.order_status) remoteStatus = remote.order_status;

      // Surface the provider's payment attempts so the return page can tell a
      // declined/dropped payment from one that is still in flight instead of
      // polling forever.
      const payments = await cashfree.fetchOrderPayments(order.gateway_order_id).catch(() => null);
      if (payments !== null && payments !== undefined) {
        gatewayPayments = cashfree.summarizePayments(payments);
      }
    }

    const remoteTerminal = ['EXPIRED', 'TERMINATED'].includes(
      String(remoteStatus || '').toUpperCase()
    );
    const terminal =
      remoteTerminal ||
      Boolean(
        gatewayPayments &&
          !gatewayPayments.succeeded &&
          !gatewayPayments.pending &&
          gatewayPayments.failed
      );
    const cancelled =
      Boolean(gatewayPayments && gatewayPayments.cancelled) ||
      cashfree.isCancelledStatus(remoteStatus);

    const { rows: invoiceOut } = await query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.order_id = $1`, [order.id]);
    res.json({
      ok: true,
      order: toOrderShape(order),
      invoice: invoiceOut[0] ? toInvoiceShape(invoiceOut[0]) : null,
      subscription: null,
      gateway: {
        provider: order.gateway_provider || 'CASHFREE',
        reference: order.gateway_reference || null,
        status: remoteStatus,
        payment_status: gatewayPayments ? gatewayPayments.latest : null,
        payment_message: gatewayPayments ? gatewayPayments.message : null,
        attempts: gatewayPayments ? gatewayPayments.attempts : null,
        cancelled,
        terminal,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Webhook
webhookRouter.post('/cashfree', async (req, res, next) => {
  try {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    if (
      !cashfree.verifyWebhookSignature({
        rawBody: raw,
        timestamp: req.get('x-webhook-timestamp'),
        signature: req.get('x-webhook-signature'),
      })
    ) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const body = req.body || {};
    const type = String(body.type || body.event_type || 'payment.success');
    const data = body.data || {};
    const orderNode = data.order || {};
    const paymentNode = data.payment || {};
    const cashfreeOrderId = orderNode.order_id || data.order_id || null;
    const cfOrderId = orderNode.cf_order_id || data.cf_order_id || null;
    const orderStatus = orderNode.order_status;
    const paymentStatus = paymentNode.payment_status;
    const succeeded =
      /SUCCESS/i.test(type) || cashfree.isPaidStatus(paymentStatus) || cashfree.isPaidStatus(orderStatus);

    const orderRow = await resolveOrder({ cfOrderId, cashfreeOrderId });
    if (!orderRow) return res.status(404).json({ error: 'Order not found' });

    const eventPayload = {
      source: 'cashfree_webhook',
      event_type: type,
      cf_order_id: cfOrderId,
      payment_status: paymentStatus || null,
      order_status: orderStatus || null,
    };

    if (!succeeded) {
      await recordGatewayEvent(orderRow, {
        provider: 'CASHFREE',
        eventType: type,
        status: 'FAILED',
        eventPayload,
      });
      return res.status(200).json({ ok: true, ignored: true });
    }

    const out = await finalizePaidOrder(orderRow, {
      provider: 'CASHFREE',
      eventType: type,
      reference: cfOrderId ? String(cfOrderId) : cashfreeOrderId,
      eventPayload,
    });

    if (out.alreadyProcessed) {
      const state = await settledState(orderRow.id);
      return res.json({ ok: true, alreadyProcessed: true, ...state });
    }

    res.json({
      ok: true,
      order: out.order,
      invoice: out.invoice,
      subscription: out.subscription,
      bonus: out.bonus,
      gateway: out.gateway,
      event: out.event,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { gatewayRouter, webhookRouter };
