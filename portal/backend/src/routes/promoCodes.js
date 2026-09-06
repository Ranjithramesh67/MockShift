'use strict';

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');
const { logAudit } = require('../auditLog');

const router = Router();

router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

const PROMO_COLUMNS = `id, code, description, discount_type, discount_value,
  currency, plan_id, max_uses, used_count, active, starts_at, expires_at,
  created_at, updated_at`;
const CODE_RE = /^[A-Z0-9_-]{2,32}$/;
const DISCOUNT_TYPES = ['PERCENT', 'FIXED'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Row object without the noise timestamps, for audit before/after payloads.
function snapshot(row) {
  if (!row) return null;
  const out = {};
  for (const key of Object.keys(row)) {
    if (key !== 'created_at' && key !== 'updated_at') out[key] = row[key];
  }
  return out;
}

function parseDateInput(value, label, errors) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    errors.push(`${label} must be an ISO-8601 string or null`);
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${label} must be a valid ISO-8601 datetime`);
    return undefined;
  }
  return parsed.toISOString();
}

function normalizeCurrency(value, errors) {
  if (value === null || value === undefined || value === '') return 'INR';
  if (typeof value !== 'string' || value.trim().length !== 3) {
    errors.push('currency must be a 3-letter code or null');
    return undefined;
  }
  return value.trim().toUpperCase();
}

// discountValue depends on the effective discount type (existing row on PUT).
function parseDiscountValue(value, discountType, errors) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    errors.push('discountValue must be a number');
    return null;
  }
  if (discountType === 'PERCENT') {
    if (n <= 0 || n > 100) {
      errors.push('discountValue must be greater than 0 and at most 100 for PERCENT discounts');
      return null;
    }
  } else if (n < 0) {
    errors.push('discountValue must be a non-negative number for FIXED discounts');
    return null;
  }
  return Math.round(n * 100) / 100;
}

/**
 * Validate a camelCase promo-code payload into snake_case DB fields.
 * `context` carries the existing row (on PUT) so partial updates validate
 * against the current discount_type. Returns { out, errors } where `out` only
 * contains fields that were supplied.
 */
function validatePayload(body, context = {}) {
  const errors = [];
  const out = {};

  if (own(body, 'code')) {
    const v = body.code;
    if (typeof v !== 'string' || !v.trim()) {
      errors.push('code must be a non-empty string');
    } else {
      const code = v.trim().toUpperCase();
      if (!CODE_RE.test(code)) {
        errors.push('code must be 2-32 characters using A-Z, 0-9, _ or - (stored uppercased)');
      } else out.code = code;
    }
  }

  if (own(body, 'description')) {
    const v = body.description;
    if (typeof v !== 'string') errors.push('description must be a string or null');
    else out.description = v.trim() === '' ? null : v;
  }

  let discountType = context.discount_type || null;
  if (own(body, 'discountType')) {
    const v = body.discountType;
    if (typeof v !== 'string' || !DISCOUNT_TYPES.includes(v)) {
      errors.push(`discountType must be one of ${DISCOUNT_TYPES.join('/')}`);
    } else {
      out.discount_type = v;
      discountType = v;
    }
  }

  if (own(body, 'discountValue')) {
    const v = parseDiscountValue(body.discountValue, discountType, errors);
    if (v !== null) out.discount_value = v;
  }

  if (own(body, 'currency')) {
    const currency = normalizeCurrency(body.currency, errors);
    if (currency !== undefined) out.currency = currency;
  }

  if (own(body, 'planId')) {
    const v = body.planId;
    if (v === null || v === undefined || v === '') out.plan_id = null;
    else if (typeof v !== 'string' || !UUID_RE.test(v)) errors.push('planId must be a valid plan id or null');
    else out.plan_id = v;
  }

  if (own(body, 'maxUses')) {
    const v = body.maxUses;
    if (v === null || v === undefined || v === '') out.max_uses = null;
    else if (!Number.isInteger(v) || v < 1) errors.push('maxUses must be a positive integer or null');
    else out.max_uses = v;
  }

  if (own(body, 'active')) {
    if (typeof body.active !== 'boolean') errors.push('active must be a boolean');
    else out.active = body.active;
  }

  for (const label of ['startsAt', 'expiresAt']) {
    if (own(body, label)) {
      const parsed = parseDateInput(body[label], label, errors);
      if (parsed !== undefined) out[label === 'startsAt' ? 'starts_at' : 'expires_at'] = parsed;
    }
  }

  return { out, errors };
}

async function planExists(planId) {
  const { rows } = await query(`SELECT 1 FROM plans WHERE id = $1`, [planId]);
  return rows.length > 0;
}

function missingCodeFields(body, errors) {
  if (!own(body, 'code') || body.code === null || body.code === undefined) {
    errors.push('code is required');
  }
  if (!own(body, 'discountType') || body.discountType === null || body.discountType === undefined) {
    errors.push('discountType is required');
  }
  if (
    !own(body, 'discountValue') ||
    body.discountValue === null ||
    body.discountValue === undefined ||
    body.discountValue === ''
  ) {
    errors.push('discountValue is required');
  }
}

// Mounted under /api/promo-codes.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PROMO_COLUMNS} FROM promo_codes ORDER BY created_at DESC, code`,
      [],
      { userId: req.user.id }
    );
    res.json({ promoCodes: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${PROMO_COLUMNS} FROM promo_codes WHERE id = $1`, [
      req.params.id,
    ], { userId: req.user.id });
    if (!rows[0]) return res.status(404).json({ error: 'Promo code not found' });
    res.json({ promoCode: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Create — MANAGER+.
router.post('/', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const { out, errors } = validatePayload(body);
    missingCodeFields(body, errors);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    if (out.plan_id && !(await planExists(out.plan_id))) {
      return res.status(400).json({ error: 'planId does not match an existing plan' });
    }

    const { rows } = await query(
      `INSERT INTO promo_codes (code, description, discount_type, discount_value,
         currency, plan_id, max_uses, active, starts_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${PROMO_COLUMNS}`,
      [
        out.code,
        out.description ?? null,
        out.discount_type,
        out.discount_value,
        out.currency ?? 'INR',
        out.plan_id ?? null,
        out.max_uses ?? null,
        out.active ?? true,
        out.starts_at ?? null,
        out.expires_at ?? null,
      ],
      { userId: req.user.id }
    );
    const row = rows[0];
    await logAudit(req, {
      action: 'promo_codes.create',
      targetType: 'promo_code',
      targetId: row.id,
      targetRef: row.code,
      after: snapshot(row),
    });
    res.status(201).json({ promoCode: row });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Promo code already exists' });
    }
    next(err);
  }
});

// Update — MANAGER+.
router.put('/:id', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const { rows: before } = await query(
      `SELECT ${PROMO_COLUMNS} FROM promo_codes WHERE id = $1`,
      [req.params.id],
      { userId: req.user.id }
    );
    if (!before[0]) return res.status(404).json({ error: 'Promo code not found' });

    const { out, errors } = validatePayload(req.body || {}, { discount_type: before[0].discount_type });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const fields = Object.keys(out);
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No updatable fields supplied' });
    }
    if (out.plan_id && !(await planExists(out.plan_id))) {
      return res.status(400).json({ error: 'planId does not match an existing plan' });
    }

    const setSql = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE promo_codes SET ${setSql}, updated_at = now()
        WHERE id = $1 RETURNING ${PROMO_COLUMNS}`,
      [req.params.id, ...fields.map((f) => out[f])],
      { userId: req.user.id }
    );
    const row = rows[0];
    await logAudit(req, {
      action: 'promo_codes.update',
      targetType: 'promo_code',
      targetId: row.id,
      targetRef: row.code,
      before: snapshot(before[0]),
      after: snapshot(row),
    });
    res.json({ promoCode: row });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Promo code already exists' });
    }
    next(err);
  }
});

// Delete — ADMIN only. Used codes are protected (409).
router.delete('/:id', requirePortalRole('ADMIN'), async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      `SELECT ${PROMO_COLUMNS} FROM promo_codes WHERE id = $1`,
      [req.params.id],
      { userId: req.user.id }
    );
    if (!existing[0]) return res.status(404).json({ error: 'Promo code not found' });
    if (existing[0].used_count > 0) {
      return res.status(409).json({ error: 'Promo code has been used and cannot be deleted' });
    }
    await query(`DELETE FROM promo_codes WHERE id = $1`, [req.params.id], {
      userId: req.user.id,
    });
    await logAudit(req, {
      action: 'promo_codes.delete',
      targetType: 'promo_code',
      targetId: existing[0].id,
      targetRef: existing[0].code,
      before: snapshot(existing[0]),
    });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
