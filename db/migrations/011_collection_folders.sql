-- ============================================================================
-- API Hub — 011_collection_folders.sql
-- Nested folders inside collections.
--
--   * `collection_folders` — a folder tree per collection. `parent_id` is a
--     self-reference; NULL means the folder sits directly under the collection
--     (a root folder). Deleting a collection cascades all of its folders;
--     deleting a folder cascades only its descendants in the tree.
--   * `api_requests.folder_id` — the folder a request belongs to (NULL = the
--     collection root). Deleting a folder SET NULLs requests back to the
--     collection root instead of destroying them.
--
-- RLS mirrors the `collections` contract: readable when the owning workspace
-- is readable; writable when the owning workspace may be mutated.
-- ============================================================================

CREATE TABLE collection_folders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES collection_folders(id) ON DELETE CASCADE,
  name          text NOT NULL,
  position      int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collection_folders_collection_idx ON collection_folders (collection_id, parent_id, position);
CREATE INDEX collection_folders_parent_idx     ON collection_folders (parent_id);

ALTER TABLE api_requests
  ADD COLUMN folder_id uuid REFERENCES collection_folders(id) ON DELETE SET NULL;

CREATE INDEX api_requests_folder_idx ON api_requests (folder_id);

-- ---------------------------------------------------------------- RLS
ALTER TABLE collection_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_folders_select ON collection_folders FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects p
                 JOIN collections c ON c.project_id = p.id
                 WHERE c.id = collection_id AND app.workspace_readable(p.workspace_id)));

CREATE POLICY collection_folders_insert ON collection_folders FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects p
                      JOIN collections c ON c.project_id = p.id
                      WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY collection_folders_update ON collection_folders FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects p
                 JOIN collections c ON c.project_id = p.id
                 WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p
                      JOIN collections c ON c.project_id = p.id
                      WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY collection_folders_delete ON collection_folders FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects p
                 JOIN collections c ON c.project_id = p.id
                 WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

-- Workload role grants (migration 001 grants only tables that existed then).
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_folders TO app_user;
