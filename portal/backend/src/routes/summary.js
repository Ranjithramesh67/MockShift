'use strict';

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');

const router = Router();

// Portal B — internal management portal summary (B1 foundation: dashboard
// counts behind RBAC, VIEWER+).
router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

router.get('/summary', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         (SELECT count(*) FROM plans)                                         AS plans,
         (SELECT count(*) FROM plans WHERE status = 'PUBLISHED')              AS published_plans,
         (SELECT count(*) FROM subscriptions)                                 AS subscriptions,
         (SELECT count(*) FROM subscriptions WHERE status = 'ACTIVE')         AS active_subscriptions,
         (SELECT count(*) FROM subscriptions WHERE status = 'TRIALING')       AS trialing_subscriptions,
         (SELECT count(*) FROM orders)                                        AS orders,
         (SELECT count(*) FROM orders WHERE status = 'PAID')                  AS paid_orders,
         (SELECT count(*) FROM invoices)                                      AS invoices,
         (SELECT count(*) FROM invoices WHERE status = 'PAID')                AS paid_invoices`,
      [],
      { userId: req.user.id }
    );
    res.json({ scope: 'portal', role: req.user.role, counts: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
