-- ============================================================================
-- API Hub — 011_folders.sql
-- Nested folders inside collections (Postman-style), plus optional
-- placement of requests inside a folder.
--
--   folders.collection_id  -> owning collection (cascade delete)
--   folders.parent_id      -> parent folder within the same collection
--                             (cascade delete -> deleting a folder removes
--                             its nested sub-folders)
--   api_requests.folder_id -> optional folder placement (SET NULL on delete,
--                             so requests resurface at the collection root)
-- ============================================================================

CREATE TABLE folders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name          text NOT NULL,
  parent_id     uuid REFERENCES folders(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folders_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX folders_collection_idx ON folders (collection_id);
CREATE INDEX folders_parent_idx     ON folders (parent_id);

ALTER TABLE api_requests
  ADD COLUMN folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX api_requests_folder_idx ON api_requests (folder_id);

-- ---------------------------------------------------------------- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO app_user;

-- ------------------------------------------------------- RLS policies
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY folders_select ON folders FOR SELECT
  USING (EXISTS (SELECT 1 FROM collections c
                 JOIN projects p ON p.id = c.project_id
                 WHERE c.id = collection_id AND app.workspace_readable(p.workspace_id)));

CREATE POLICY folders_insert ON folders FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM collections c
                      JOIN projects p ON p.id = c.project_id
                      WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY folders_update ON folders FOR UPDATE
  USING (EXISTS (SELECT 1 FROM collections c
                 JOIN projects p ON p.id = c.project_id
                 WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM collections c
                      JOIN projects p ON p.id = c.project_id
                      WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY folders_delete ON folders FOR DELETE
  USING (EXISTS (SELECT 1 FROM collections c
                 JOIN projects p ON p.id = c.project_id
                 WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

-- Folders must nest within their own collection (parent must share the
-- same collection_id as the child).
CREATE OR REPLACE FUNCTION app.folders_parent_same_collection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM folders f WHERE f.id = NEW.parent_id AND f.collection_id = NEW.collection_id
    ) THEN
      RAISE EXCEPTION 'parent folder must belong to the same collection';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER folders_parent_same_collection
  BEFORE INSERT OR UPDATE OF parent_id, collection_id ON folders
  FOR EACH ROW EXECUTE FUNCTION app.folders_parent_same_collection();

-- Requests assigned to a folder must live in the same collection as the folder.
CREATE OR REPLACE FUNCTION app.requests_folder_same_collection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM folders f
      WHERE f.id = NEW.folder_id AND f.collection_id = NEW.collection_id
    ) THEN
      RAISE EXCEPTION 'folder must belong to the same collection as the request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER requests_folder_same_collection
  BEFORE INSERT OR UPDATE OF folder_id, collection_id ON api_requests
  FOR EACH ROW EXECUTE FUNCTION app.requests_folder_same_collection();
