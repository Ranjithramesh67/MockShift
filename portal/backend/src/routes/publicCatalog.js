'use strict';

const { Router } = require('express');
const { query } = require('../shared');

const router = Router();

// Portal A — public catalog. No auth: only PUBLISHED plans, ordered for the
// showcase/pricing page. Strips internal columns (drafts never leak, no admin
// fields exposed).
const PUBLIC_COLUMNS = `id, key, name, tagline, description, price_monthly,
  price_yearly, currency, billing_cycles, trial_days, sort_order, limits,
  features`;

router.get('/plans', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PUBLIC_COLUMNS} FROM plans
        WHERE status = 'PUBLISHED' ORDER BY sort_order, created_at`
    );
    res.json({ plans: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/plans/:key', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PUBLIC_COLUMNS} FROM plans WHERE key = $1 AND status = 'PUBLISHED'`,
      [req.params.key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
