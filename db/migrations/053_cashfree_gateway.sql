-- ============================================================================
-- API Hub — 053_cashfree_gateway.sql
-- Real payment gateway (Cashfree) integration + login gate state.
--
-- Portal A previously settled orders through a simulated gateway. This
-- migration adds the state required by the real Cashfree Payments flow while
-- leaving every existing column/status untouched:
--
--   1. orders gains the provider-side order id (cf_order_id) and the hosted
--      checkout session id (payment_session_id) so a PENDING order can be
--      resumed and reconciled against Cashfree without re-creating it.
--   2. portal_settings gains `payment_gate_required` (default TRUE): the master
--      switch that blocks customers with an unpaid, non-free order from
--      logging in / using the app until the payment is confirmed. Platform
--      ADMINs and customers with no PENDING paid order are never blocked.
--
-- Additive only; no existing rows are modified.
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_order_id   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_session_id text;

COMMENT ON COLUMN orders.gateway_order_id IS
  'Provider-side order id (e.g. Cashfree cf_order_id) for the real gateway.';
COMMENT ON COLUMN orders.gateway_session_id IS
  'Hosted checkout session id (e.g. Cashfree payment_session_id) for the real gateway.';

CREATE INDEX IF NOT EXISTS orders_gateway_order_idx ON orders (gateway_order_id);

ALTER TABLE portal_settings
  ADD COLUMN IF NOT EXISTS payment_gate_required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN portal_settings.payment_gate_required IS
  'Master switch for the payment login gate. When TRUE, a customer whose account has a PENDING paid order and no ACTIVE/TRIALING subscription is refused login and app access (402 payment_required) until the order is confirmed. Platform ADMINs are exempt.';

-- Single-row table: make sure the bootstrap row has the column defaulted even
-- on an older database that already had the table without it.
UPDATE portal_settings SET payment_gate_required = true
  WHERE payment_gate_required IS NULL;
