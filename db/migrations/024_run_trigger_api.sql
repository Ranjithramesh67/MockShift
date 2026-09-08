-- ============================================================================
-- API Hub — 024_run_trigger_api.sql
-- Add the `api` run trigger used by server-side stored-request runs
-- (roadmap S5: POST /api/runs). Server-side runs are executed by a session
-- user or an API token acting as its owner; the trigger distinguishes them
-- from MANUAL (in-app send) runs in run history.
-- ============================================================================

ALTER TYPE run_trigger ADD VALUE IF NOT EXISTS 'api';
