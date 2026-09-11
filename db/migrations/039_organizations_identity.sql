-- ============================================================================
-- API Hub — 039_organizations_identity.sql
-- Account identity: distinguish an individual's personal organization from a
-- company organization, and record the company email domain so teammates on
-- the same domain auto-join one shared org (auto-join by domain).
--
--   PERSONAL — auto-created "<Name>'s Org" for consumer/public signups
--              (personal email providers such as gmail.com, yahoo.com, ...).
--   COMPANY  — created on the first signup for a non-personal domain
--              (e.g. acme.com -> "Acme"). Later @acme.com signups join it as
--              EDITOR instead of getting their own org.
--
-- `domain` is normalized lowercase and only set for COMPANY orgs; a partial
-- unique index keeps exactly one company org per domain. The migration is
-- additive: existing rows default to PERSONAL and no data is rewritten.
-- ============================================================================

CREATE TYPE org_kind AS ENUM ('PERSONAL', 'COMPANY');

ALTER TABLE organizations
  ADD COLUMN kind       org_kind    NOT NULL DEFAULT 'PERSONAL',
  ADD COLUMN domain     text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Exactly one COMPANY org per company domain; PERSONAL orgs leave domain NULL.
CREATE UNIQUE INDEX organizations_company_domain_uidx
  ON organizations (domain)
  WHERE kind = 'COMPANY' AND domain IS NOT NULL;

CREATE INDEX organizations_kind_idx ON organizations (kind);
