'use strict';

// ---------------------------------------------------------------------------
// Portal A (A6): simulated payment gateway. POST /api/public/gateway/:id/pay
// is the "customer pressed Pay now" step of the checkout. It simulates the
// external PSP charge and then settles the order through the same idempotent
// webhook-finalization code the real provider webhook uses (paymentFinalize),
// so the UI never drifts from the webhook semantics. Owner-only; replaying on
// an already-PAID order is a no-op (200 alreadyProcessed).
// ---------------------------------------------------------------------------

const { Router } = require('express');
const { query, access } = require('../shared');
const { logAudit } = require('../auditLog');
const {
  isUuid,
  fetchSubscriptionShape,
  toOrderShape,
  toInvoiceShape,
  ORDER_COLUMNS,
  INVOICE_COLUMNS,
} = require('./publicCheckout')._helpers;
const { finalizePaidOrder, settledState } = require('../paymentFinalize');

const router = Router();

router.post('/:orderId/pay', access.requireAuth, async (req, res, next) => {
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

    if (order.status !== 'PENDING') {
      const state = await settledState(orderId);
      return res.json({
        ok: true,
        alreadyProcessed: true,
        order: state.order,
        invoice: state.invoice,
        subscription: state.subscription,
      });
    }
    if (Number(order.amount) <= 0) {
      return res.status(400).json({
        error: 'This order has no amount due — free plans activate instantly without a gateway',
      });
    }

    const out = await finalizePaidOrder(order, {
      provider: 'SIMULATED_GATEWAY',
      eventType: 'charge.succeeded',
      eventPayload: { source: 'gateway_pay', card_brand: 'SIM', card_last4: '4242' },
    });

    if (out.alreadyProcessed) {
      const state = await settledState(orderId);
      return res.json({
        ok: true,
        alreadyProcessed: true,
        order: state.order,
        invoice: state.invoice,
        subscription: state.subscription,
      });
    }

    await logAudit(req, {
      action: 'payments.gateway_pay',
      targetType: 'order',
      targetId: orderId,
      targetRef: `${out.gateway.provider}/${order.plan_key}`,
      before: { status: 'PENDING', gateway_status: order.gateway_status || null },
      after: {
        status: 'PAID',
        gateway_status: 'SUCCEEDED',
        gateway_reference: out.gateway.reference,
      },
    });

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

// Current order + invoice for the gateway page (owner only; mirrors the
// checkout orders reader but keeps the gateway namespace self-contained).
router.get('/:orderId/status', access.requireAuth, async (req, res, next) => {
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

    res.json({
      order: toOrderShape(order),
      invoice: invoiceRows[0] ? toInvoiceShape(invoiceRows[0]) : null,
      subscription,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
