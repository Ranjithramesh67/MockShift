-- ============================================================================
-- API Hub — 016_portal_checkout_rls.sql
-- Portal A (A4) purchase flow defense-in-depth.
--
-- Migration 013 gave `subscriptions` an INSERT policy (own user OR a portal
-- ADMIN/MANAGER) but `orders` and `invoices` only had SELECT + UPDATE
-- policies, so a customer's self-purchase INSERT would be denied once the
-- application ever runs under a non-superuser role. Mirror the subscription
-- INSERT policy on both tables: a user may place/own their own orders and
-- invoices, and portal ops (ADMIN/MANAGER) may place them on any user's
-- behalf (as the B3 lifecycle already does).
--
-- The current application connects as a privileged role that bypasses RLS, so
-- this is not behaviourally required today — it closes the gap documented in
-- 013 for a future dedicated app role.
-- ============================================================================

CREATE POLICY orders_insert ON orders FOR INSERT
  WITH CHECK (user_id = app.current_user_id()
              OR app.portal_role() IN ('ADMIN', 'MANAGER'));

CREATE POLICY invoices_insert ON invoices FOR INSERT
  WITH CHECK (user_id = app.current_user_id()
              OR app.portal_role() IN ('ADMIN', 'MANAGER'));
