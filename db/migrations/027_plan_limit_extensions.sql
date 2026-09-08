-- ============================================================================
-- API Hub — 027_plan_limit_extensions.sql
-- Per-plan usage restrictions (Portal B): three NEW canonical limit keys for
-- each non-enterprise plan:
--
--   api_requests  — number of stored requests an org pool may create.
--   mock_servers  — number of per-project mock servers an org pool may run.
--   doc_pages     — number of documentation pages an org pool may create.
--
-- Mirrors the 019 backfill form (limits || new) so it is idempotent and
-- preserves editor-added extras (enforce / sso / saml / sla / future keys).
-- team sets the three keys to explicit null (unlimited); enterprise is left
-- untouched because entitlements.js already exempts it (R8). Values mirror
-- the FREE_FALLBACK_LIMITS defaults in backend/src/api/entitlements.js.
--
-- NOTE: the matrix self-test and the docs /usage endpoint may READ the plans
-- catalog; these numbers stay applied (intended end state).
-- ============================================================================

UPDATE plans SET limits = limits || '{
  "api_requests": 50, "mock_servers": 1, "doc_pages": 20
}'::jsonb, updated_at = now() WHERE key = 'free';

UPDATE plans SET limits = limits || '{
  "api_requests": 250, "mock_servers": 3, "doc_pages": 100
}'::jsonb, updated_at = now() WHERE key = 'starter';

UPDATE plans SET limits = limits || '{
  "api_requests": 1000, "mock_servers": 10, "doc_pages": 500
}'::jsonb, updated_at = now() WHERE key = 'pro';

UPDATE plans SET limits = limits || '{
  "api_requests": null, "mock_servers": null, "doc_pages": null
}'::jsonb, updated_at = now() WHERE key = 'team';
