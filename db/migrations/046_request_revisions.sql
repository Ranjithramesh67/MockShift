-- --------------------------------------------- Request edit revisions (history)
-- Append-only per-request edit history: who changed what, before/after, and
-- rollbacks. snapshot is the post-change request in the camelCase shape from
-- backend/src/api/requestSnapshot.js; changed_fields is [{field, from, to}].
CREATE TABLE request_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES api_requests(id) ON DELETE CASCADE,
  collection_id    uuid NOT NULL REFERENCES collections(id)  ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES workspaces(id)   ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  revision_number  integer NOT NULL,
  change_kind      text NOT NULL,
  snapshot         jsonb NOT NULL,
  changed_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,
  rolled_back_from uuid REFERENCES request_revisions(id) ON DELETE SET NULL,
  created_by       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_revisions_kind_check CHECK (change_kind IN ('create', 'update', 'rollback')),
  UNIQUE (request_id, revision_number)
);

CREATE INDEX request_revisions_request_idx ON request_revisions (request_id, revision_number DESC);
CREATE INDEX request_revisions_author_idx  ON request_revisions (created_by);

COMMENT ON TABLE request_revisions IS
  'Append-only request edit history; snapshot is the post-change request, changed_fields is [{field,from,to}].';
COMMENT ON COLUMN request_revisions.rolled_back_from IS
  'For change_kind=rollback, the revision whose snapshot was restored.';

-- Immutable: readers only select, writers only insert.
GRANT SELECT, INSERT ON request_revisions TO app_user;

ALTER TABLE request_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_revisions_select ON request_revisions FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY request_revisions_insert ON request_revisions FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));
