-- 060_creator_attribution.sql
--
-- Creator attribution for hierarchical content containers. Org analytics needs
-- to credit the member who created each workspace / project / collection /
-- folder / mock server, which none of these tables recorded before. All columns
-- are nullable and additive; rows created after this migration are stamped by
-- the create routes.
--
-- Existing rows are backfilled on a best-effort basis:
--   * projects      <- audit_logs 'project_created' 's first actor
--   * mock_servers  <- audit_logs 'create_mock_server' 's first actor
--   * workspaces    <- owning organization's owner_id (auto-provisioned
--                      "My Workspace" belongs to the org owner)
--   * collections   <- first request revision's author, else org owner
--   * folders       <- the parent collection's creator
-- Unresolvable rows stay NULL and are simply reported as unattributed.

BEGIN;

ALTER TABLE workspaces   ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE collections  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE folders      ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE mock_servers ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workspaces_created_by_idx   ON workspaces (created_by);
CREATE INDEX IF NOT EXISTS projects_created_by_idx     ON projects (created_by);
CREATE INDEX IF NOT EXISTS collections_created_by_idx  ON collections (created_by);
CREATE INDEX IF NOT EXISTS folders_created_by_idx      ON folders (created_by);
CREATE INDEX IF NOT EXISTS mock_servers_created_by_idx ON mock_servers (created_by);

-- projects: first "project_created" audit entry for the project.
UPDATE projects p
   SET created_by = al.actor_id
  FROM (
    SELECT DISTINCT ON (entity_id) entity_id, actor_id
      FROM audit_logs
     WHERE entity_type = 'project'
       AND action = 'project_created'
       AND entity_id IS NOT NULL
       AND actor_id IS NOT NULL
     ORDER BY entity_id, created_at ASC
  ) al
 WHERE p.id = al.entity_id
   AND p.created_by IS NULL;

-- mock servers: first "create_mock_server" audit entry.
UPDATE mock_servers ms
   SET created_by = al.actor_id
  FROM (
    SELECT DISTINCT ON (entity_id) entity_id, actor_id
      FROM audit_logs
     WHERE entity_type = 'mock_server'
       AND action = 'create_mock_server'
       AND entity_id IS NOT NULL
       AND actor_id IS NOT NULL
     ORDER BY entity_id, created_at ASC
  ) al
 WHERE ms.id = al.entity_id
   AND ms.created_by IS NULL;

-- workspaces: auto-provisioned workspaces belong to the org owner.
UPDATE workspaces w
   SET created_by = o.owner_id
  FROM organizations o
 WHERE w.organization_id = o.id
   AND w.created_by IS NULL;

-- collections: earliest recorded request revision author.
UPDATE collections c
   SET created_by = rr.created_by
  FROM (
    SELECT DISTINCT ON (collection_id) collection_id, created_by
      FROM request_revisions
     WHERE collection_id IS NOT NULL
     ORDER BY collection_id, created_at ASC, revision_number ASC
  ) rr
 WHERE c.id = rr.collection_id
   AND c.created_by IS NULL;

-- collections: remaining ones fall back to the owning organization's owner.
UPDATE collections c
   SET created_by = o.owner_id
  FROM workspaces w
  JOIN organizations o ON o.id = w.organization_id
 WHERE c.workspace_id = w.id
   AND c.created_by IS NULL;

-- folders: inherit the parent collection's creator.
UPDATE folders f
   SET created_by = c.created_by
  FROM collections c
 WHERE f.collection_id = c.id
   AND f.created_by IS NULL
   AND c.created_by IS NOT NULL;

COMMIT;
