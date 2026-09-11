-- ============================================================================
-- API Hub — 038_mock_call_log_response.sql
-- Capture the served mock response on the call log.
--
--   response_headers  response headers actually written (lower-cased keys)
--   response_body      response body actually written (server-capped)
--
-- The dispatch call-log hook already observes every mock response through the
-- patched res.end; these columns let the call-log UI show the full exchange
-- (request query/headers/body + response status/headers/body) instead of only
-- the status code.
-- ============================================================================

ALTER TABLE mock_call_logs
  ADD COLUMN response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN response_body    text  NOT NULL DEFAULT '';

COMMENT ON COLUMN mock_call_logs.response_headers IS
  'Response headers written by the mock dispatch, captured from res.getHeaders().';
COMMENT ON COLUMN mock_call_logs.response_body IS
  'Response body written by the mock dispatch (server-capped at MAX_CALL_BODY).';
