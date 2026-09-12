-- Trigram indexes for global search (ILIKE '%q%' on name/title columns).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS workspaces_name_trgm      ON workspaces    USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS projects_name_trgm        ON projects      USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS collections_name_trgm     ON collections   USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS folders_name_trgm         ON folders       USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS api_requests_name_trgm    ON api_requests  USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS api_requests_url_trgm     ON api_requests  USING gin (url   gin_trgm_ops);
CREATE INDEX IF NOT EXISTS doc_pages_title_trgm      ON doc_pages     USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contract_specs_name_trgm  ON contract_specs USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS monitors_name_trgm        ON monitors      USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS mock_scenarios_name_trgm  ON mock_scenarios USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS workflow_chains_name_trgm ON workflow_chains USING gin (name gin_trgm_ops);
