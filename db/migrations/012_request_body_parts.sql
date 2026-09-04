-- ============================================================================
-- API Hub — 012_request_body_parts.sql
-- Structured multipart/form-data body parts (Postman-style) so requests can
-- carry text AND file parts. The parts array lives in api_requests.body_parts
-- (jsonb):
--
--   [
--     { "id": "...", "key": "title",   "enabled": true, "kind": "text",
--       "value": "Hello" },
--     { "id": "...", "key": "avatar",  "enabled": true, "kind": "file",
--       "fileName": "me.png", "fileType": "image/png", "fileSize": 1234 }
--   ]
--
-- File BYTES are never persisted: only the file reference (name/mime/size) is
-- saved. When a multipart request is executed the caller re-supplies the file
-- bytes for each enabled file part (base64 in the run payload); the runner
-- builds a real multipart/form-data body from the parts.
--
-- Legacy raw-text multipart bodies (body_text set, body_parts NULL) keep the
-- old execution path, so pre-existing requests are unaffected.
-- ============================================================================

ALTER TABLE api_requests
  ADD COLUMN body_parts jsonb;
