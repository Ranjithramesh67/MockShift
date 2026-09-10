-- ============================================================================
-- API Hub — 037_sdk_sync.sql
-- Route sync for the apihub-sdk JS library (round 5).
--
--   api_tokens.project_id / workspace_id  optional binding: a key scoped to a
--                                         single project OR workspace (not both)
--   scope 'sdk'                           allows POST /api/sdk/sync
--   api_requests.external_key             stable SDK identity -> idempotent upsert
--   folders.external_key                  stable SDK identity -> idempotent upsert
--   sdk_sync_runs                         one audit row per sync call
--
-- Idempotency: the SDK sends a stable `key` per folder/request (e.g.
-- "GET /users/:id"). The route upserts on (collection_id, external_key) so
-- repeated syncs update the same rows instead of duplicating them.
-- ============================================================================

-- ------------------------------------------------------ token binding + scope
ALTER TABLE api_tokens
  ADD COLUMN project_id   uuid REFERENCES projects(id)   ON DELETE CASCADE,
  ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE api_tokens DROP CONSTRAINT IF EXISTS api_tokens_scopes_check;
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_scopes_check
  CHECK (scopes <@ ARRAY['read', 'write', 'runs', 'sdk']::text[]);

ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_binding_check
  CHECK (NOT (project_id IS NOT NULL AND workspace_id IS NOT NULL));

CREATE INDEX api_tokens_project_idx   ON api_tokens (project_id)   WHERE project_id IS NOT NULL;
CREATE INDEX api_tokens_workspace_idx ON api_tokens (workspace_id) WHERE workspace_id IS NOT NULL;

COMMENT ON COLUMN api_tokens.project_id   IS 'When set, this key may only sync/create content inside this project.';
COMMENT ON COLUMN api_tokens.workspace_id IS 'When set, this key may create/find a project by name inside this workspace and sync into it.';

-- --------------------------------------------------- idempotent external keys
ALTER TABLE api_requests
  ADD COLUMN external_key text,
  ADD COLUMN source       text,
  ADD COLUMN source_file  text,
  ADD COLUMN synced_at    timestamptz;

CREATE UNIQUE INDEX api_requests_external_key_uidx
  ON api_requests (collection_id, external_key)
  WHERE external_key IS NOT NULL;

ALTER TABLE folders
  ADD COLUMN external_key text,
  ADD COLUMN source       text;

CREATE UNIQUE INDEX folders_external_key_uidx
  ON folders (collection_id, external_key)
  WHERE external_key IS NOT NULL;

ALTER TABLE collections
  ADD COLUMN source text;

-- ------------------------------------------------------------- sync run log
CREATE TABLE sdk_sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id      uuid REFERENCES api_tokens(id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  collection_id uuid REFERENCES collections(id)         ON DELETE SET NULL,
  source        text,
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sdk_sync_runs_project_idx ON sdk_sync_runs (project_id, created_at DESC);

COMMENT ON TABLE sdk_sync_runs IS
  'One row per apihub-sdk sync call; summary holds { folders:{created,updated}, requests:{created,updated,pruned} }.';

-- ------------------------------------------------------------------ Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON sdk_sync_runs TO app_user;

-- ------------------------------------------------------------- RLS policies
ALTER TABLE sdk_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sdk_sync_runs_select ON sdk_sync_runs FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY sdk_sync_runs_insert ON sdk_sync_runs FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));
