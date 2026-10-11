-- 006_request_assertions.sql
-- Per-request response assertions (status, JSON path, header, response time).
-- Config is stored as a JSONB list on the request; evaluation results are
-- recorded in the existing test_results table at run time.

ALTER TABLE api_requests
  ADD COLUMN assertions jsonb NOT NULL DEFAULT '[]'::jsonb;
