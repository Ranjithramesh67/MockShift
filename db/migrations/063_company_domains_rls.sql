-- ============================================================================
-- Mockshift — 063_company_domains_rls.sql
-- Harden the company_domains RLS policies introduced in 052.
--
-- 052 left INSERT/UPDATE/DELETE open to every app connection (`USING/WITH
-- CHECK (true)`), relying solely on the route layer for authorization. That is
-- fragile: a single unguarded query path (or a SQL-injection foothold) could
-- rewrite the registry and misclassify every account on a domain.
--
-- This migration:
--   * keeps SELECT open (classification happens pre-auth at signup/login);
--   * restricts INSERT/UPDATE/DELETE to platform ADMIN/MANAGER, matching the
--     two callers (main-app admin routes = ADMIN, portal routes = MANAGER+);
--   * moves the signup/login "link a registered domain to its organization"
--     update, which legitimately runs without an admin session, into a
--     narrowly-scoped SECURITY DEFINER function so the UPDATE policy itself
--     can be locked down.
--
-- Additive only; no rows are rewritten.
-- ============================================================================

-- Link a registry row to the organization serving its domain. Signup/login
-- call this without an admin context; it can only set organization_id on an
-- existing row (never create/delete or rename a domain).
CREATE OR REPLACE FUNCTION app.link_company_domain(_domain text, _org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF _domain IS NULL OR _org_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE company_domains
     SET organization_id = _org_id
   WHERE domain = _domain
     AND (organization_id IS NULL OR organization_id <> _org_id);
END;
$$;

GRANT EXECUTE ON FUNCTION app.link_company_domain(text, uuid) TO app_user;

DROP POLICY IF EXISTS company_domains_insert ON company_domains;
DROP POLICY IF EXISTS company_domains_update ON company_domains;
DROP POLICY IF EXISTS company_domains_delete ON company_domains;

CREATE POLICY company_domains_insert ON company_domains FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = app.current_user_id() AND u.role IN ('ADMIN', 'MANAGER')
    )
  );

CREATE POLICY company_domains_update ON company_domains FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = app.current_user_id() AND u.role IN ('ADMIN', 'MANAGER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = app.current_user_id() AND u.role IN ('ADMIN', 'MANAGER')
    )
  );

CREATE POLICY company_domains_delete ON company_domains FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = app.current_user_id() AND u.role IN ('ADMIN', 'MANAGER')
    )
  );
