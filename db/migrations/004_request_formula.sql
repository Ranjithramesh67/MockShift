-- ============================================================================
-- API Hub — 004_request_formula.sql
-- Adds the pre-request formula column to api_requests so the request editor's
-- Formula tab is persisted and executed by the Run path.
-- ============================================================================

ALTER TABLE api_requests
  ADD COLUMN IF NOT EXISTS formula text NOT NULL DEFAULT '';
