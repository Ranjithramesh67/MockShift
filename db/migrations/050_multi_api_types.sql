-- 050_multi_api_types.sql
-- Align Postgres enums with the app:
--   * http_method already used QUERY in the API/FE but 001_init omitted it
--   * body_type gains XML so SOAP/XML bodies are not smuggled as RAW_TEXT

ALTER TYPE http_method ADD VALUE IF NOT EXISTS 'QUERY';
ALTER TYPE body_type ADD VALUE IF NOT EXISTS 'XML';
