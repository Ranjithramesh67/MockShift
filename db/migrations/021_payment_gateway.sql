-- ============================================================================
-- API Hub — 021_payment_gateway.sql
-- Portal A (A6) simulated payment gateway + webhook finalization.
--
-- A4 confirmed an order instantly (PENDING -> PAID) with no explicit payment
-- step. A6 makes the payment explicit: after checkout a customer is sent to a
-- simulated gateway, presses "Pay now", and the API performs an "external"
-- charge that is then settled by a provider webhook (POST
-- /api/public/webhooks/payment). The webhook marks the PENDING order PAID and
-- the DRAFT invoice PAID, creates the ACTIVE subscription (applying the
-- plan's first-recharge bonus) and supersedes any prior ACTIVE/TRIALING plan
-- via the existing app.supersede_subscriptions() helper (migration 017).
--
-- This migration only adds state for that flow:
--   1. orders gain gateway columns (charge status/provider/reference + paid_at)
--      so receipts and Portal B can see how an order was settled; existing
--      columns/statuses are untouched (PENDING/PAID checks stay intact).
--   2. payment_gateway_events — an append-only webhook/delivery log (provider
--      event id, type, status, raw payload) mirroring what a real PSP would
--      record. One row per webhook receipt incl. duplicate re-deliveries, and
--      one row per synchronous gateway finalization.
--
-- RLS note: mirrors the 013/016/017 pattern — policies are defense-in-depth
-- for a future dedicated app role (the API connects as a privileged role
-- today and grants app_user the same table privileges used elsewhere).
-- ============================================================================

-- ------------------------------------------------------------- orders state
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_status   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_provider text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_reference text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at          timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_gateway_status_check'
       AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_gateway_status_check
      CHECK (gateway_status IS NULL OR gateway_status IN ('PENDING', 'SUCCEEDED', 'FAILED'));
  END IF;
END;
$$;

COMMENT ON COLUMN orders.gateway_status IS
  'Simulated gateway charge state: NULL (no gateway yet) | PENDING | SUCCEEDED | FAILED.';
COMMENT ON COLUMN orders.gateway_provider IS
  'Provider that settled the order, e.g. SIMULATED_GATEWAY / SIMULATED_CARD.';
COMMENT ON COLUMN orders.gateway_reference IS
  'Provider-side reference/transaction id shown on the receipt.';
COMMENT ON COLUMN orders.paid_at IS
  'When the order was actually paid (set by webhook/gateway finalization).';

-- ----------------------------------------------------- webhook/event log
CREATE TABLE IF NOT EXISTS payment_gateway_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider   text NOT NULL,
  event_type text NOT NULL DEFAULT 'charge.succeeded',
  status     text NOT NULL
             CHECK (status IN ('RECEIVED', 'SUCCEEDED', 'FAILED', 'DUPLICATE', 'IGNORED')),
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_gateway_events_order_idx
  ON payment_gateway_events (order_id);
CREATE INDEX IF NOT EXISTS payment_gateway_events_created_idx
  ON payment_gateway_events (created_at DESC);

COMMENT ON TABLE payment_gateway_events IS
  'Append-only log of simulated-gateway charge events + provider webhook deliveries (one row per receipt; re-deliveries are logged as DUPLICATE).';
COMMENT ON COLUMN payment_gateway_events.status IS
  'RECEIVED (logged) | SUCCEEDED (order finalized) | FAILED | DUPLICATE (replay) | IGNORED.';

ALTER TABLE payment_gateway_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_gateway_events_select ON payment_gateway_events;
CREATE POLICY payment_gateway_events_select ON payment_gateway_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM orders o
                  WHERE o.id = payment_gateway_events.order_id
                    AND o.user_id = app.current_user_id())
         OR app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'));

DROP POLICY IF EXISTS payment_gateway_events_insert ON payment_gateway_events;
CREATE POLICY payment_gateway_events_insert ON payment_gateway_events FOR INSERT
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER')
              OR EXISTS (SELECT 1 FROM orders o
                          WHERE o.id = payment_gateway_events.order_id
                            AND o.user_id = app.current_user_id()));

GRANT SELECT, INSERT ON payment_gateway_events TO app_user;
