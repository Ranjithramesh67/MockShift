-- ============================================================================
-- API Hub — 013_portal_plans_subscriptions.sql
-- Subscription portal domain (milestone A1 + B1 of the two-portal plan):
--
--  1. New global role SUPPORT (sits between VIEWER and MANAGER) for the
--     internal subscription management portal (Portal B).
--  2. plans          — the public subscription catalog (standalone SaaS).
--  3. subscriptions  — a user's subscription to a plan (one per plan/cycle).
--  4. orders         — purchase records (mock/manual invoicing for now).
--  5. invoices       — billing documents referencing an order.
--
-- RLS note: mirrors the pattern in 001/002/003. Policies are provided for
-- consistency and defense-in-depth; the application connects as a privileged
-- role for now, and real authorization is enforced by the portal API
-- middleware (roles ADMIN/MANAGER/SUPPORT/VIEWER — see endpoint matrix in
-- portal/backend/src/portalAccess.js).
--
-- Reference data: the five placeholder plans (INR) Ranjith specified on
-- 2026-09-04 — Free / Starter / Pro / Team / Enterprise with workspace,
-- project and storage limits in `limits` (null = unlimited).
-- ============================================================================

ALTER TYPE role ADD VALUE IF NOT EXISTS 'SUPPORT';

-- ---------------------------------------------------------------- Plans
CREATE TABLE plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL UNIQUE,                -- slug, e.g. 'pro'
  name           text NOT NULL,
  tagline        text,
  description    text,
  price_monthly  numeric(12,2),                       -- NULL => custom pricing
  price_yearly   numeric(12,2),
  currency       text NOT NULL DEFAULT 'INR',
  billing_cycles text[] NOT NULL DEFAULT ARRAY['MONTHLY', 'YEARLY'],
  trial_days     integer NOT NULL DEFAULT 0,
  sort_order     integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  limits         jsonb NOT NULL DEFAULT '{}',         -- machine-readable limits
  features       jsonb NOT NULL DEFAULT '[]',         -- marketing bullets
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------- Subscriptions
CREATE TABLE subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id               uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'TRIALING'
                        CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE',
                                          'SUSPENDED', 'CANCELLED', 'EXPIRED')),
  billing_cycle         text NOT NULL DEFAULT 'MONTHLY'
                        CHECK (billing_cycle IN ('MONTHLY', 'YEARLY', 'CUSTOM')),
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  trial_ends_at         timestamptz,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  cancelled_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_idx     ON subscriptions (user_id);
CREATE INDEX subscriptions_plan_idx     ON subscriptions (plan_id);
CREATE INDEX subscriptions_status_idx   ON subscriptions (status);

-- ---------------------------------------------------------------- Orders
CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id           uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  subscription_id   uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount            numeric(12,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'INR',
  billing_cycle     text NOT NULL DEFAULT 'MONTHLY'
                    CHECK (billing_cycle IN ('MONTHLY', 'YEARLY', 'CUSTOM')),
  status            text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'VOID')),
  payment_method    text NOT NULL DEFAULT 'MANUAL',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_user_idx ON orders (user_id);
CREATE INDEX orders_plan_idx ON orders (plan_id);

-- -------------------------------------------------------------- Invoices
CREATE TABLE invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number      text NOT NULL UNIQUE,                   -- e.g. 'INV-2026-0001'
  amount      numeric(12,2) NOT NULL,
  currency    text NOT NULL DEFAULT 'INR',
  status      text NOT NULL DEFAULT 'DRAFT'
              CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'VOID')),
  issued_at   timestamptz,
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoices_user_idx ON invoices (user_id);

-- ------------------------------------------------- Portal RLS helpers
-- Effective global role of the session user (mirrors app.current_user_id()).
-- Returns NULL when no session is set.
CREATE OR REPLACE FUNCTION app.portal_role() RETURNS role LANGUAGE sql STABLE AS $$
  SELECT role FROM users WHERE id = app.current_user_id()
$$;

-- Public catalog is readable by anyone; everything else requires a portal role.
ALTER TABLE plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices       ENABLE ROW LEVEL SECURITY;

CREATE POLICY plans_select ON plans FOR SELECT
  USING (status = 'PUBLISHED'
         OR app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'));
CREATE POLICY plans_insert ON plans FOR INSERT
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));
CREATE POLICY plans_update ON plans FOR UPDATE
  USING (app.portal_role() IN ('ADMIN', 'MANAGER'))
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));
CREATE POLICY plans_delete ON plans FOR DELETE
  USING (app.portal_role() = 'ADMIN');

CREATE POLICY subscriptions_select ON subscriptions FOR SELECT
  USING (user_id = app.current_user_id()
         OR app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'));
CREATE POLICY subscriptions_insert ON subscriptions FOR INSERT
  WITH CHECK (user_id = app.current_user_id()
              OR app.portal_role() IN ('ADMIN', 'MANAGER'));
CREATE POLICY subscriptions_update ON subscriptions FOR UPDATE
  USING (app.portal_role() IN ('ADMIN', 'MANAGER'))
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));

CREATE POLICY orders_select ON orders FOR SELECT
  USING (user_id = app.current_user_id()
         OR app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'));
CREATE POLICY orders_update ON orders FOR UPDATE
  USING (app.portal_role() IN ('ADMIN', 'MANAGER'))
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));

CREATE POLICY invoices_select ON invoices FOR SELECT
  USING (user_id = app.current_user_id()
         OR app.portal_role() IN ('ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'));
CREATE POLICY invoices_update ON invoices FOR UPDATE
  USING (app.portal_role() IN ('ADMIN', 'MANAGER'))
  WITH CHECK (app.portal_role() IN ('ADMIN', 'MANAGER'));

-- Portal RLS runs as app_user in db/tests (SET ROLE app_user); grant the
-- same table privileges 011/012 use for later tables, plus execute on the new
-- RLS helper.
GRANT SELECT, INSERT, UPDATE, DELETE ON plans, subscriptions, orders, invoices TO app_user;
GRANT EXECUTE ON FUNCTION app.portal_role() TO app_user;

-- --------------------------------------- Placeholder plan catalog (INR)
INSERT INTO plans (key, name, tagline, price_monthly, price_yearly, currency,
                   billing_cycles, trial_days, sort_order, status, limits, features)
VALUES
  ('free', 'Free', 'Start free, no card required', 0, 0, 'INR',
   ARRAY['MONTHLY', 'YEARLY'], 0, 1, 'PUBLISHED',
   '{"workspaces":1,"projects":1,"storage_mb":200,"public_sharing":false,"seats":1}'::jsonb,
   '["1 workspace","1 project","200 MB storage","Community support"]'::jsonb),
  ('starter', 'Starter', 'For small teams getting started', 99, 990, 'INR',
   ARRAY['MONTHLY', 'YEARLY'], 14, 2, 'PUBLISHED',
   '{"workspaces":5,"projects":5,"storage_mb":2048,"public_sharing":false,"seats":5}'::jsonb,
   '["5 workspaces","5 projects","2 GB storage","Email support"]'::jsonb),
  ('pro', 'Pro', 'Most popular for growing teams', 299, 2990, 'INR',
   ARRAY['MONTHLY', 'YEARLY'], 14, 3, 'PUBLISHED',
   '{"workspaces":25,"projects":25,"storage_mb":10240,"public_sharing":true,"seats":25}'::jsonb,
   '["25 workspaces","25 projects","10 GB storage","Priority support","API access"]'::jsonb),
  ('team', 'Team', 'Collaborate across larger orgs', 799, 7990, 'INR',
   ARRAY['MONTHLY', 'YEARLY'], 14, 4, 'PUBLISHED',
   '{"workspaces":null,"projects":null,"storage_mb":null,"public_sharing":true,"seats":10,"sso":true}'::jsonb,
   '["Unlimited private & public workspaces and projects","Everything in Pro","10 seats","SSO","Advanced roles","Audit log"]'::jsonb),
  ('enterprise', 'Enterprise', 'Custom pricing — contact sales', NULL, NULL, 'INR',
   ARRAY['CUSTOM'], 0, 5, 'PUBLISHED',
   '{"workspaces":null,"projects":null,"storage_mb":null,"public_sharing":true,"seats":null,"sso":true,"saml":true,"sla":true}'::jsonb,
   '["Everything in Team","Unlimited seats","SAML SSO","SLA","Dedicated CSM"]'::jsonb);
