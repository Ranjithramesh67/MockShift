'use strict';

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');

const router = Router();

// Portal B: catalog management (see endpoint matrix in portalAccess.js).
router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const CYCLES = ['MONTHLY', 'YEARLY', 'CUSTOM'];
const PLAN_COLUMNS = `id, key, name, tagline, description, price_monthly,
  price_yearly, currency, billing_cycles, trial_days, sort_order, status,
  limits, features, created_at, updated_at`;

function toNull(value) {
  return value === undefined || value === null ? null : value;
}

function validatePayload(body) {
  const errors = [];
  const out = {};

  const key = toNull(body.key);
  if (key !== null) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      errors.push('key must be a lowercase slug (a-z, 0-9, hyphens)');
    } else out.key = key;
  }

  const name = toNull(body.name);
  if (name !== null) {
    if (typeof name !== 'string' || !name.trim()) errors.push('name is required');
    else out.name = name.trim();
  }

  for (const src of ['tagline', 'description']) {
    const v = toNull(body[src]);
    if (v !== null) {
      if (typeof v !== 'string') errors.push(`${src} must be a string`);
      else out[src] = v;
    }
  }

  for (const src of ['priceMonthly', 'priceYearly']) {
    const v = toNull(body[src]);
    if (v !== null) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        errors.push(`${src} must be a non-negative number or null`);
      } else out[src] = v;
    }
  }

  const currency = toNull(body.currency);
  if (currency !== null) {
    if (typeof currency !== 'string' || currency.length !== 3) {
      errors.push('currency must be a 3-letter code');
    } else out.currency = currency.toUpperCase();
  }

  const cycles = toNull(body.billingCycles);
  if (cycles !== null) {
    if (!Array.isArray(cycles) || cycles.length === 0 || !cycles.every((c) => CYCLES.includes(c))) {
      errors.push(`billingCycles must be a non-empty array of ${CYCLES.join('/')}`);
    } else out.billing_cycles = cycles;
  }

  const trialDays = toNull(body.trialDays);
  if (trialDays !== null) {
    if (!Number.isInteger(trialDays) || trialDays < 0) {
      errors.push('trialDays must be a non-negative integer');
    } else out.trial_days = trialDays;
  }

  const sortOrder = toNull(body.sortOrder);
  if (sortOrder !== null) {
    if (!Number.isInteger(sortOrder)) errors.push('sortOrder must be an integer');
    else out.sort_order = sortOrder;
  }

  const status = toNull(body.status);
  if (status !== null) {
    if (!STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join('/')}`);
    else out.status = status;
  }

  for (const src of ['limits', 'features']) {
    const v = toNull(body[src]);
    if (v !== null && (typeof v !== 'object' || Array.isArray(v) !== (src === 'features'))) {
      errors.push(`${src} must be ${src === 'features' ? 'an array' : 'an object'}`);
    } else if (v !== null) {
      out[src] = v;
    }
  }

  return { out, errors };
}

// Mounted under /api/plans — management list (all statuses).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PLAN_COLUMNS} FROM plans ORDER BY sort_order, created_at`
    );
    res.json({ plans: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Create — MANAGER+ (see matrix in portalAccess.js).
router.post('/', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const { out, errors } = validatePayload(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (!out.key || !out.name) {
      return res.status(400).json({ error: 'key and name are required' });
    }
    const { rows } = await query(
      `INSERT INTO plans (key, name, tagline, description, price_monthly,
        price_yearly, currency, billing_cycles, trial_days, sort_order, status,
        limits, features)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${PLAN_COLUMNS}`,
      [
        out.key,
        out.name,
        out.tagline ?? null,
        out.description ?? null,
        out.priceMonthly ?? 0,
        out.priceYearly ?? 0,
        out.currency ?? 'INR',
        out.billing_cycles ?? ['MONTHLY', 'YEARLY'],
        out.trial_days ?? 0,
        out.sort_order ?? 0,
        out.status ?? 'DRAFT',
        JSON.stringify(out.limits ?? {}),
        JSON.stringify(out.features ?? []),
      ]
    );
    res.status(201).json({ plan: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Plan key already exists' });
    next(err);
  }
});

// Update — MANAGER+.
router.put('/:id', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const { out, errors } = validatePayload(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const fields = Object.keys(out);
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No updatable fields supplied' });
    }
    const setSql = fields
      .map((f, i) => `${f} = $${i + 2}`)
      .join(', ');
    const values = fields.map((f) =>
      f === 'limits' || f === 'features' ? JSON.stringify(out[f]) : out[f]
    );
    const { rows } = await query(
      `UPDATE plans SET ${setSql}, updated_at = now()
        WHERE id = $1 RETURNING ${PLAN_COLUMNS}`,
      [req.params.id, ...values]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Plan key already exists' });
    next(err);
  }
});

// Delete — ADMIN only. Plans referenced by subscriptions/orders are protected
// by ON DELETE RESTRICT in migration 013.
router.delete('/:id', requirePortalRole('ADMIN'), async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM plans WHERE id = $1 RETURNING id`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Plan is referenced by subscriptions or orders' });
    }
    next(err);
  }
});

module.exports = router;
