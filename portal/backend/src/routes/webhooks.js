'use strict';

// ---------------------------------------------------------------------------
// Portal A (A6): simulated provider webhook endpoint. A real PSP would POST
// charge results here; the demo gateway "Pay now" flow settles through the
// SAME finalization code. Public by design (no customer session) — the request
// is authenticated by a provider-shared secret header (x-webhook-secret), the
// analog of a webhook signature. Finalization is idempotent: replaying a
// delivery for an already-settled order is logged as a DUPLICATE event and
// returns 200 with the current state (no second subscription).
//
// Body: { order_id, provider?, event?, status?, reference?, payload? }
//   order_id  uuid of the PENDING order to settle (required)
//   status    SUCCEEDED/SUCCESS/COMPLETED/PAID => settle; anything else is a
//             FAILED charge (order stays PENDING, event row logged)
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { Router } = require('express');
const { query } = require('../shared');
const { logAudit } = require('../auditLog');
const { isUuid, toOrderShape } = require('./publicCheckout')._helpers;
const {
  fetchOrderRow,
  finalizePaidOrder,
  settledState,
  recordGatewayEvent,
  isSuccessfulStatus,
} = require('../paymentFinalize');

const router = Router();

// The mock gateway is opt-in dev/test tooling (mounted only when
// ALLOW_MOCK_GATEWAY=1). Even so, never fall back to a committed secret: an
// unset secret fails closed so a misconfigured deployment cannot have its
// orders settled with a publicly known value.
const WEBHOOK_SECRET = () => String(process.env.GATEWAY_WEBHOOK_SECRET || '').trim();

function signatureMatches(value) {
  const expected = WEBHOOK_SECRET();
  if (!expected) return false;
  const a = Buffer.from(String(value || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function loadActor(userId) {
  const { rows } = await query('SELECT id, name, role FROM users WHERE id = $1', [userId]);
  return rows[0] || { id: userId, name: 'unknown', role: null };
}

router.post('/payment', async (req, res, next) => {
  try {
    const secret =
      req.get('x-webhook-secret') || req.get('x-signature') || req.get('authorization');
    if (!signatureMatches(secret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const body = req.body || {};
    const orderId = body.order_id || body.orderId;
    if (!isUuid(orderId || '')) {
      return res.status(400).json({ error: 'order_id (uuid) is required' });
    }

    const provider = String(body.provider || 'SIMULATED_GATEWAY').toUpperCase();
    const eventType = String(body.event || body.event_type || 'charge.succeeded');
    const reference = body.reference || body.event_id || null;

    const orderRow = await fetchOrderRow(orderId);
    if (!orderRow) return res.status(404).json({ error: 'Order not found' });

    const auditActor = { user: await loadActor(orderRow.user_id), ip: req.ip };

    if (!isSuccessfulStatus(body.status)) {
      await recordGatewayEvent(orderRow, {
        provider,
        eventType,
        status: 'FAILED',
        eventPayload: { source: 'webhook', reason: body.reason || 'charge_failed' },
      });
      await logAudit(auditActor, {
        action: 'payments.webhook_charge_failed',
        targetType: 'order',
        targetId: orderRow.id,
        targetRef: `${provider}/${orderRow.plan_key}`,
        before: { order: orderRow.status, gateway_status: orderRow.gateway_status || null },
        after: { order: orderRow.status, gateway_status: 'FAILED' },
      });
      return res.status(422).json({
        ok: false,
        error: 'Charge was not successful — order remains pending',
        order: toOrderShape(orderRow),
      });
    }

    if (orderRow.status !== 'PENDING') {
      // Re-delivery of an already-settled order: log the delivery, stay put.
      await recordGatewayEvent(orderRow, {
        provider,
        eventType,
        status: 'DUPLICATE',
        eventPayload: { source: 'webhook', reference },
      });
      await logAudit(auditActor, {
        action: 'payments.webhook_replayed',
        targetType: 'order',
        targetId: orderRow.id,
        targetRef: `${provider}/${orderRow.plan_key}`,
        before: { order: orderRow.status },
        after: { order: orderRow.status },
      });
      const state = await settledState(orderId);
      return res.json({
        ok: true,
        alreadyProcessed: true,
        order: state.order,
        invoice: state.invoice,
        subscription: state.subscription,
      });
    }

    const out = await finalizePaidOrder(orderRow, {
      provider,
      eventType,
      reference,
      eventPayload: { source: 'webhook', reference },
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

    await logAudit(auditActor, {
      action: 'payments.webhook_finalized',
      targetType: 'order',
      targetId: orderRow.id,
      targetRef: `${provider}/${orderRow.plan_key}`,
      before: { order: 'PENDING', invoice: 'DRAFT' },
      after: {
        order: 'PAID',
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

module.exports = router;
