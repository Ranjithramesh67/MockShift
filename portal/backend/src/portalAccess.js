'use strict';

// ---------------------------------------------------------------------------
// Portal B RBAC — Portal B (subscription management) roles and endpoint matrix.
//
// Roles (global `users.role`, SUPPORT added by migration 013):
//   ADMIN   — full control: plans CRUD (incl. delete), subscription lifecycle,
//             order/invoice refund & void, settings, audit export.
//   MANAGER — operations: plans create/edit, subscription lifecycle
//             (activate/suspend/cancel/change plan), order/invoice manage.
//   SUPPORT — read-mostly: view plans/subscriptions/orders/invoices and
//             subscriber details; no mutations.
//   VIEWER  — read-only portal access (no subscriber PII in list views).
//   EDITOR (platform role) is NOT a portal role — denied portal access.
//
// Endpoint matrix (min role that may call an action):
//   plans.list / plans.read        VIEWER
//   plans.write (create/update)    MANAGER
//   plans.delete                   ADMIN
//   subs.read / orders.read        VIEWER        (self-service read later: user)
//   subs.manage (lifecycle)        MANAGER
//   order.refund / invoice.void    ADMIN
//   portal.summary                 VIEWER
//   settings.read                  VIEWER        (future)
//   settings.write / audit.export  ADMIN         (future)
//
// Authorization is enforced in Express middleware here (authoritative). The DB
// RLS policies in migration 013 mirror this matrix for defense-in-depth.
// ---------------------------------------------------------------------------

const { access } = require('./shared');

const PORTAL_ROLE_RANK = { ADMIN: 4, MANAGER: 3, SUPPORT: 2, VIEWER: 1 };
const PORTAL_ROLES = Object.keys(PORTAL_ROLE_RANK);

/**
 * True when `role` is a portal role of rank >= the required minimum.
 */
function roleAtLeast(role, min) {
  if (!role || !(role in PORTAL_ROLE_RANK) || !(min in PORTAL_ROLE_RANK)) return false;
  return PORTAL_ROLE_RANK[role] >= PORTAL_ROLE_RANK[min];
}

/**
 * Express middleware: user must be authenticated with a portal role >= minRole.
 * Place AFTER requireAuth. Default 'VIEWER' = any portal role.
 */
function requirePortalRole(minRole = 'VIEWER') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roleAtLeast(req.user.role, minRole)) {
      return res.status(403).json({
        error: `Requires portal role${minRole !== 'VIEWER' ? ` at or above ${minRole}` : ''}`,
      });
    }
    next();
  };
}

module.exports = { PORTAL_ROLE_RANK, PORTAL_ROLES, roleAtLeast, requirePortalRole, access };
