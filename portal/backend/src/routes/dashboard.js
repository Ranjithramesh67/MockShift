'use strict';

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');

const router = Router();

// Portal B — subscription-management dashboard (B2). VIEWER+.
router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

function parseLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// GET /summary — aggregate KPI counts for the dashboard.
router.get('/summary', async (req, res, next) => {
  try {
    const [countsResult, plansResult] = await Promise.all([
      query(
        `SELECT
           (SELECT count(*)::int FROM subscriptions)                                  AS total_subscriptions,
           (SELECT count(*)::int FROM subscriptions WHERE status = 'ACTIVE')          AS active,
           (SELECT count(*)::int FROM subscriptions WHERE status = 'TRIALING')        AS trialing,
           (SELECT count(*)::int FROM subscriptions WHERE status = 'PAST_DUE')        AS past_due,
           (SELECT count(*)::int FROM subscriptions WHERE status = 'SUSPENDED')       AS suspended,
           (SELECT count(*)::int FROM subscriptions WHERE status = 'CANCELLED')       AS cancelled,
           (SELECT count(*)::int FROM subscriptions
             WHERE status = 'TRIALING'
               AND trial_ends_at IS NOT NULL
               AND trial_ends_at <= now() + interval '7 days')                        AS trials_ending_soon,
           (SELECT count(*)::int FROM subscriptions
             WHERE status = 'ACTIVE'
               AND current_period_end IS NOT NULL
               AND current_period_end <= now() + interval '14 days')                  AS expiring_soon,
           (SELECT count(*)::int FROM subscriptions
             WHERE created_at >= date_trunc('month', now()))                          AS new_this_month,
           (SELECT count(*)::int FROM subscriptions
             WHERE cancelled_at IS NOT NULL
               AND cancelled_at >= date_trunc('month', now()))                        AS churn_this_month,
           (SELECT COALESCE(round(SUM(CASE s.billing_cycle
               WHEN 'MONTHLY' THEN COALESCE(p.price_monthly, 0)
               WHEN 'YEARLY'  THEN COALESCE(p.price_yearly, 0) / 12.0
               ELSE 0 END), 2), 0)::text
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.status IN ('ACTIVE', 'TRIALING'))                                AS mrr,
           (SELECT COALESCE(SUM(o.amount), 0)::text FROM orders o
             WHERE o.status = 'PAID'
               AND o.created_at >= now() - interval '30 days')                        AS revenue30d,
           (SELECT count(*)::int FROM orders)                                         AS total_orders,
           (SELECT count(*)::int FROM orders WHERE status = 'PAID')                   AS paid_orders,
           (SELECT count(*)::int FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.status = 'ACTIVE' AND p.price_monthly = 0 AND p.price_yearly = 0) AS free_seats`,
        [],
        { userId: req.user.id }
      ),
      query(
        `SELECT p.key, p.name, p.status,
           (SELECT count(*)::int FROM subscriptions s
              WHERE s.plan_id = p.id AND s.status = 'ACTIVE')    AS active,
           (SELECT count(*)::int FROM subscriptions s
              WHERE s.plan_id = p.id AND s.status = 'TRIALING')  AS trialing
           FROM plans p
           ORDER BY p.sort_order, p.created_at`,
        [],
        { userId: req.user.id }
      ),
    ]);

    const row = countsResult.rows[0];
    res.json({
      scope: 'portal',
      role: req.user.role,
      summary: {
        totalSubscriptions: row.total_subscriptions,
        active: row.active,
        trialing: row.trialing,
        pastDue: row.past_due,
        suspended: row.suspended,
        cancelled: row.cancelled,
        trialsEndingSoon: row.trials_ending_soon,
        expiringSoon: row.expiring_soon,
        newThisMonth: row.new_this_month,
        churnThisMonth: row.churn_this_month,
        mrr: row.mrr,
        revenue30d: row.revenue30d,
        totalOrders: row.total_orders,
        paidOrders: row.paid_orders,
        freeSeats: row.free_seats,
        plans: plansResult.rows.map((p) => ({
          key: p.key,
          name: p.name,
          active: p.active,
          trialing: p.trialing,
          status: p.status,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /recent-subscriptions?limit=
router.get('/recent-subscriptions', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit);
    const { rows } = await query(
      `SELECT s.id, s.user_id, u.name AS user_name, u.email AS user_email,
              p.key AS plan_key, p.name AS plan_name,
              s.status, s.billing_cycle, s.created_at
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN plans p ON p.id = s.plan_id
         ORDER BY s.created_at DESC
         LIMIT $1`,
      [limit],
      { userId: req.user.id }
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        user: { id: r.user_id, name: r.user_name, email: r.user_email },
        plan_key: r.plan_key,
        plan_name: r.plan_name,
        status: r.status,
        billing_cycle: r.billing_cycle,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /recent-orders?limit=
router.get('/recent-orders', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit);
    const { rows } = await query(
      `SELECT o.id, o.user_id, u.name AS user_name, u.email AS user_email,
              p.key AS plan_key, p.name AS plan_name,
              o.amount::text AS amount, o.currency, o.status, o.created_at
         FROM orders o
         JOIN users u ON u.id = o.user_id
         JOIN plans p ON p.id = o.plan_id
         ORDER BY o.created_at DESC
         LIMIT $1`,
      [limit],
      { userId: req.user.id }
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        user: { id: r.user_id, name: r.user_name, email: r.user_email },
        plan_key: r.plan_key,
        plan_name: r.plan_name,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
