-- ============================================================================
-- API Hub — 015_portal_audit_promo.sql
-- Portal B management tables (milestone B4/B5 of the two-portal plan):
--
--  1. audit_log    — immutable trail of every admin/manager action in Portal B
--                    (actor, action, target, before/after JSON). Written by the
--                    shared auditLog helper; read via /api/audit.
--  2. promo_codes  — discount codes applied at checkout / manual order entry.
--
-- RLS mirrors migration 013: policies exist for defense-in-depth; the portal
-- API middleware (portalAccess.js) is authoritative. Grants to app_user are
-- provided so db/tests can exercise the policies.
-- ============================================================================

-- -------------------------------------------------------------- audit_log
CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_name     text NOT NULL,                 -- display snapshot
  actor_role     text NOT NULL,                 -- role snapshot (ADMIN/…)
  action         text NOT NULL,                 -- 'plans.create', 'subscriptions.suspend', …
  target_type    text NOT NULL,                 -- plan | subscription | order | invoice | promo_code | user | …
  target_id      uuid,
  target_ref     text,                          -- plan key / order id / code / email
  before         jsonb,
  after          jsonb,
  ip_address     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_idx    ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx      ON audit_log (actor_user_id);
CREATE INDEX audit_log_action_idx     ON audit_log (action);
CREATE INDEX audit_log_target_idx     ON audit_log (target_type, target_id);

-- ---------------------------------------------------------- promo_codes
CREATE TABLE promo_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,          -- uppercased, e.g. 'LAUNCH20'
  description    text,
  discount_type  text NOT NULL DEFAULT 'PERCENT'
                 CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value numeric(10,2) NOT NULL,
  currency       text NOT NULL DEFAULT 'INR',
  plan_id        uuid REFERENCES plans(id) ON DELETE CASCADE,  -- NULL = any plan
  max_uses       integer,                       -- NULL = unlimited
  used_count     integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  starts_at      timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX promo_codes_active_idx ON promo_codes (active);

-- --------------------------------------------------------- RLS policies
ALTER TABLE audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes  ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT'));
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'));

CREATE POLICY promo_codes_select ON promo_codes FOR SELECT
  USING (app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'));
CREATE POLICY promo_codes_insert ON promo_codes FOR INSERT
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));
CREATE POLICY promo_codes_update ON promo_codes FOR UPDATE
  USING (app.portal_role() IN ('ADMIN', 'MANAGER'))
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));
CREATE POLICY promo_codes_delete ON promo_codes FOR DELETE
  USING (app.portal_role() = 'ADMIN');

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log, promo_codes TO app_user;
