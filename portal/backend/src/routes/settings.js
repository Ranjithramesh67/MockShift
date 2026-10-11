'use strict';

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');
const { logAudit } = require('../auditLog');

const router = Router();

// Portal B — global restrictions settings (L1). Single portal_settings row
// (migration 019): `restrictions_enforced` is the master switch that
// short-circuits every per-plan usage gate when OFF. `payment_gate_required`
// (migration 053) is the master switch for the payment login gate.
//
//   GET /api/portal/settings   VIEWER+
//   PUT /api/portal/settings   MANAGER+  body { restrictions_enforced?, payment_gate_required? }
router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT restrictions_enforced, payment_gate_required, updated_by, updated_at
         FROM portal_settings ORDER BY id LIMIT 1`,
      [],
      { userId: req.user.id }
    );
    res.json({
      settings: rows[0] || {
        restrictions_enforced: true,
        payment_gate_required: true,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const hasRestrictions = typeof body.restrictions_enforced === 'boolean';
    const hasPayment = typeof body.payment_gate_required === 'boolean';
    if (!hasRestrictions && !hasPayment) {
      return res.status(400).json({
        error: 'Provide restrictions_enforced and/or payment_gate_required as booleans',
      });
    }
    const restrictions = hasRestrictions ? body.restrictions_enforced : null;
    const payment = hasPayment ? body.payment_gate_required : null;
    const { rows } = await query(
      `INSERT INTO portal_settings
         (id, restrictions_enforced, payment_gate_required, updated_by, updated_at)
       VALUES (true, COALESCE($1::boolean, true), COALESCE($2::boolean, true), $3, now())
       ON CONFLICT (id) DO UPDATE
         SET restrictions_enforced = COALESCE($1::boolean, portal_settings.restrictions_enforced),
             payment_gate_required = COALESCE($2::boolean, portal_settings.payment_gate_required),
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
       RETURNING restrictions_enforced, payment_gate_required, updated_by, updated_at`,
      [restrictions, payment, req.user.id],
      { userId: req.user.id }
    );
    const settings = rows[0];
    await logAudit(req, {
      action: 'settings.update',
      targetType: 'settings',
      targetId: 'portal',
      targetRef: 'portal_settings',
      before: null,
      after: {
        restrictions_enforced: settings.restrictions_enforced,
        payment_gate_required: settings.payment_gate_required,
      },
    });
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
