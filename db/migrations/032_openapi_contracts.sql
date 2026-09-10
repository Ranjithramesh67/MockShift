-- ============================================================================
-- API Hub — 032_openapi_contracts.sql
-- OpenAPI import + contract validation (E1):
--   contract_specs   an imported OpenAPI/Swagger 3.x document, scoped to a
--                    project (optionally bound to the collection generated from
--                    it). The raw document is stored verbatim as jsonb so a
--                    later import can be diffed against it; spec_hash is a
--                    content digest used to detect an identical re-import.
--   contract_checks  attaches one operation/response of a spec to a stored
--                    request, so a live run's response can be validated against
--                    that operation's response schema (the `contract`
--                    assertion source). One row per (request, spec, operation,
--                    status); status_code defaults to 'default', meaning the
--                    operation's 'default' response or its first 2xx response.
--
-- Callers may instead pass the assertion inline; `method` and `path` are
-- normalized (upper-case verb, leading-slash path).
-- ============================================================================

CREATE TABLE contract_specs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
  name          text NOT NULL,
  version       text,
  spec          jsonb NOT NULL,
  spec_hash     text NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contract_specs_project_idx    ON contract_specs (project_id, created_at DESC);
CREATE INDEX contract_specs_collection_idx ON contract_specs (collection_id);

CREATE TABLE contract_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES api_requests(id) ON DELETE CASCADE,
  spec_id     uuid NOT NULL REFERENCES contract_specs(id) ON DELETE CASCADE,
  method      text NOT NULL,
  path        text NOT NULL,
  status_code text NOT NULL DEFAULT 'default',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, spec_id, method, path, status_code)
);

CREATE INDEX contract_checks_request_idx ON contract_checks (request_id);
CREATE INDEX contract_checks_spec_idx    ON contract_checks (spec_id);
