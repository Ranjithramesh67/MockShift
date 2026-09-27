-- ============================================================================
-- MockShift — 061_sdk_response_schema.sql
-- Additive metadata captured by mockshift-sdk's runtime observer: inferred
-- request/response structure for each synced request. Nullable so existing
-- rows and non-SDK flows are unaffected.
-- ============================================================================

ALTER TABLE api_requests
  ADD COLUMN IF NOT EXISTS request_schema jsonb;

ALTER TABLE api_requests
  ADD COLUMN IF NOT EXISTS response_schema jsonb;
