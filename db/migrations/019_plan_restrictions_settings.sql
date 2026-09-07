-- ============================================================================
-- API Hub — 019_plan_restrictions_settings.sql
-- Per-plan usage restrictions (Portal B), L1: the master "restrictions
-- enforced" switch plus the canonical limit catalog backfill.
--
--  1. portal_settings — single-row settings table. restrictions_enforced is
--     the global master switch for every creation gate (R7): default TRUE so
--     enforcement is live in the dev/preview DB. Portal B (MANAGER+) reads and
--     flips it via GET/PUT /api/portal/settings.
--  2. plans.limits backfill — the dev demo seed previously inserted plans
--     WITHOUT the limits column and refreshed only trial_days on conflict, so
--     every dev plan row ended up with limits = '{}'. This migration pushes
--     the canonical catalog numbers (mirroring migration 013; null = unlimited
--     and new keys collections/teams/runs_per_month default to unlimited) so
--     enforcement is demonstrable immediately. The merge form
--     (limits || new) is idempotent and preserves editor-added extras
--     (enforce / sso / saml / sla / future keys).
--
-- The run-usage counter table for L4 ships in migration 020.
-- ============================================================================

-- ------------------------------------------------- single-row settings
CREATE TABLE portal_settings (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  restrictions_enforced boolean NOT NULL DEFAULT true,
  updated_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE portal_settings IS
  'Single-row portal settings. restrictions_enforced=false short-circuits every plan-limit creation gate (R7 global toggle).';
COMMENT ON COLUMN portal_settings.restrictions_enforced IS
  'Master switch for per-plan usage restrictions. Default TRUE. Enterprise/custom plans and per-plan enforce:false overrides are never limited regardless.';

INSERT INTO portal_settings (id, restrictions_enforced) VALUES (true, true)
  ON CONFLICT (id) DO NOTHING;

-- Defense-in-depth RLS mirroring migration 013: portal roles may read; only
-- Portal B ops (ADMIN/MANAGER) may flip the switch.
ALTER TABLE portal_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_settings_select ON portal_settings FOR SELECT
  USING (app.portal_role() IS NOT NULL);
CREATE POLICY portal_settings_update ON portal_settings FOR UPDATE
  USING (app.portal_role() IN ('ADMIN', 'MANAGER'))
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));

GRANT SELECT, UPDATE ON portal_settings TO app_user;

-- -------------------------------------------- canonical limit backfill
-- Idempotent: merge canonical numbers on top of whatever is stored, keeping
-- any non-canonical keys (sso, saml, sla, enforce, future keys).
UPDATE plans SET limits = limits || '{
  "workspaces": 1, "projects": 1, "collections": null, "teams": null,
  "seats": 1, "storage_mb": 200, "runs_per_month": null,
  "public_sharing": false
}'::jsonb, updated_at = now() WHERE key = 'free';

UPDATE plans SET limits = limits || '{
  "workspaces": 5, "projects": 5, "collections": null, "teams": null,
  "seats": 5, "storage_mb": 2048, "runs_per_month": null,
  "public_sharing": false
}'::jsonb, updated_at = now() WHERE key = 'starter';

UPDATE plans SET limits = limits || '{
  "workspaces": 25, "projects": 25, "collections": null, "teams": null,
  "seats": 25, "storage_mb": 10240, "runs_per_month": null,
  "public_sharing": true
}'::jsonb, updated_at = now() WHERE key = 'pro';

UPDATE plans SET limits = limits || '{
  "workspaces": null, "projects": null, "collections": null, "teams": null,
  "seats": 10, "storage_mb": null, "runs_per_month": null,
  "public_sharing": true, "sso": true
}'::jsonb, updated_at = now() WHERE key = 'team';

UPDATE plans SET limits = limits || '{
  "workspaces": null, "projects": null, "collections": null, "teams": null,
  "seats": null, "storage_mb": null, "runs_per_month": null,
  "public_sharing": true, "sso": true, "saml": true, "sla": true
}'::jsonb, updated_at = now() WHERE key = 'enterprise';
