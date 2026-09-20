-- API Hub — 055_promo_redemption.sql
--
-- Promo-code redemption at self-service checkout.
--
-- Before this migration `promo_codes` could only be created/edited in the
-- portal admin UI (routes/promoCodes.js); nothing ever consumed a code and an
-- order stored only the final `amount`. This migration records the breakdown on
-- the order so the gateway charges the discounted total and the admin views can
-- show what was applied:
--
--   subtotal        amount before the promo discount (the catalog or prorated
--                   upgrade figure), NULL for legacy rows
--   discount_amount promo discount actually applied (0 when none)
--   promo_code_id   FK to the redeemed code (SET NULL if the code is deleted)
--   promo_code      the code TEXT snapshot, kept even if the row is edited
--
-- `orders.amount` remains the authoritative charge: the Cashfree session
-- endpoint reads it directly, so persisting the discounted value there is all
-- the gateway needs. `used_count` is reserved at order creation (inside the
-- checkout transaction, with the promo row locked FOR UPDATE) so concurrent
-- checkouts cannot oversell a limited code.
--
-- Append-only: do not edit earlier migrations.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code text;

-- Existing rows were never discounted, so the pre-discount subtotal equals the
-- amount that was charged.
UPDATE orders SET subtotal = amount WHERE subtotal IS NULL;

CREATE INDEX IF NOT EXISTS orders_promo_code_idx
  ON orders (promo_code_id)
  WHERE promo_code_id IS NOT NULL;

COMMENT ON COLUMN orders.subtotal IS
  'Amount before any promo-code discount (catalog or prorated upgrade figure).';
COMMENT ON COLUMN orders.discount_amount IS
  'Promo-code discount applied to this order; 0 when no code was used.';
COMMENT ON COLUMN orders.promo_code_id IS
  'Redeemed promo code, if any (NULLed if the promo code row is deleted).';
COMMENT ON COLUMN orders.promo_code IS
  'Text snapshot of the redeemed code, preserved for receipts.';
