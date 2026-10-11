'use strict';

// ---------------------------------------------------------------------------
// Portal B audit helper — single write point for the immutable audit trail.
// Every mutating route (plans, subscribers, promo codes, orders/invoices)
// calls `logAudit` with the action it performed. Reads/export live in
// routes/audit.js (SUPPORT+/ADMIN).
//
// Usage (inside a route handler with req.user populated by requireAuth):
//   const { logAudit } = require('../auditLog');
//   await logAudit(req, {
//     action: 'subscriptions.suspend',
//     targetType: 'subscription',
//     targetId: subId,
//     targetRef: planKeyOrLabel,
//     before: { status: 'ACTIVE' },
//     after: { status: 'SUSPENDED' },
//   });
// ---------------------------------------------------------------------------

const { query } = require('./shared');

/**
 * Insert one audit row. Always resolves; a logging failure must never fail the
 * business operation, so errors are swallowed and surfaced via console.warn.
 */
async function logAudit(
  req,
  { action, targetType, targetId = null, targetRef = null, before = null, after = null }
) {
  const user = req.user || {};
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, actor_name, actor_role, action,
         target_type, target_id, target_ref, before, after, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        user.id ?? null,
        user.name ?? user.email ?? 'unknown',
        user.role ?? null,
        action,
        targetType,
        targetId,
        targetRef,
        before === undefined || before === null ? null : JSON.stringify(before),
        after === undefined || after === null ? null : JSON.stringify(after),
        req.ip || null,
      ],
      { userId: user.id }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[audit] log failed', action, err.message);
  }
}

module.exports = { logAudit };
