'use strict';

// Promo-code redemption for self-service checkout.
//
// A code is validated against the requested plan and the pre-discount amount
// (`base`) inside the checkout transaction. `resolvePromo` locks the promo row
// `FOR UPDATE` so two concurrent checkouts cannot both pass the `max_uses`
// check; `consumePromo` then bumps `used_count` before the transaction commits.
// Reserving the use at order creation (rather than at payment) is deliberate: it
// can never oversell a limited code, at the cost of an abandoned unpaid order
// still counting as a use.
//
// Errors carry `status` (400) and `promoCode` (machine-readable reason) so the
// checkout/quote routes can surface them to the customer.

const PROMO_COLUMNS = `id, code, description, discount_type, discount_value,
  currency, plan_id, max_uses, used_count, active, starts_at, expires_at`;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function promoError(code, message) {
  const err = new Error(message);
  err.status = 400;
  err.promoCode = code;
  return err;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function toPromoShape(promo) {
  if (!promo) return null;
  return {
    code: promo.code,
    description: promo.description || null,
    discountType: promo.discount_type,
    discountValue: Number(promo.discount_value),
  };
}

/**
 * Validate `code` against `plan` for a `base` (pre-discount) amount. Must run on
 * a transaction client: it locks the promo row. Returns
 * `{ promo, base, discount, total }`; `promo` is null when no code was given.
 */
async function resolvePromo(client, { code, plan, amount }) {
  const normalized = normalizeCode(code);
  const base = round2(amount);
  if (!normalized) return { promo: null, base, discount: 0, total: base };

  const { rows } = await client.query(
    `SELECT ${PROMO_COLUMNS} FROM promo_codes WHERE upper(code) = $1 FOR UPDATE`,
    [normalized]
  );
  const promo = rows[0];
  if (!promo) throw promoError('promo_not_found', 'That promo code is not valid.');
  if (!promo.active) throw promoError('promo_inactive', 'That promo code is no longer active.');

  const now = Date.now();
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now) {
    throw promoError('promo_not_started', 'That promo code is not active yet.');
  }
  if (promo.expires_at && new Date(promo.expires_at).getTime() <= now) {
    throw promoError('promo_expired', 'That promo code has expired.');
  }
  if (promo.plan_id && promo.plan_id !== plan.id) {
    throw promoError('promo_plan_mismatch', 'That promo code is not valid for this plan.');
  }
  if (
    promo.currency &&
    plan.currency &&
    String(promo.currency).toUpperCase() !== String(plan.currency).toUpperCase()
  ) {
    throw promoError('promo_currency_mismatch', 'That promo code is not valid in this currency.');
  }
  if (promo.max_uses !== null && Number(promo.used_count) >= Number(promo.max_uses)) {
    throw promoError('promo_exhausted', 'That promo code has reached its usage limit.');
  }

  let discount;
  if (promo.discount_type === 'PERCENT') {
    discount = round2((base * Number(promo.discount_value)) / 100);
  } else {
    discount = round2(Number(promo.discount_value));
  }
  discount = Math.max(0, Math.min(discount, base));
  return { promo, base, discount, total: round2(base - discount) };
}

/**
 * Reserve one use of a promo code. Guarded so a concurrent checkout that already
 * exhausted the code cannot push `used_count` past `max_uses`.
 */
async function consumePromo(client, promoId) {
  if (!promoId) return;
  await client.query(
    `UPDATE promo_codes
        SET used_count = used_count + 1, updated_at = now()
      WHERE id = $1 AND (max_uses IS NULL OR used_count < max_uses)`,
    [promoId]
  );
}

module.exports = { resolvePromo, consumePromo, toPromoShape, normalizeCode, round2, promoError };
