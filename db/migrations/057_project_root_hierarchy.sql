-- ============================================================================
-- 057_project_root_hierarchy.sql
--
-- Invert the ownership hierarchy to:
--     organization -> project -> workspace -> collection -> folder/request
-- from the previous:
--     organization -> workspace -> project -> collection -> folder/request
--
-- Strategy: ADDITIVE and non-destructive.
--   * New canonical edges are added and back-filled:
--       projects.organization_id, workspaces.project_id, collections.workspace_id
--   * Legacy edges (projects.workspace_id, collections.project_id) are retained,
--     made nullable, and kept in sync by triggers so existing queries keep
--     working while the application migrates to the new direction.
--   * No columns or rows are dropped, so this migration is safe to re-run from
--     scratch (empty database) and on the live database (1 project per
--     workspace, verified 2026-09-22).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- projects
-- Project becomes the top-level container, directly owned by an organization.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE projects p
   SET organization_id = w.organization_id
  FROM workspaces w
 WHERE w.id = p.workspace_id
   AND p.organization_id IS NULL;

ALTER TABLE projects ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS projects_organization_idx ON projects (organization_id);

-- Legacy edge becomes optional (data preserved).
ALTER TABLE projects ALTER COLUMN workspace_id DROP NOT NULL;

-- -------------------------------------------------------------- workspaces
-- Workspace nests under a project.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS project_id uuid
  REFERENCES projects(id) ON DELETE CASCADE;

UPDATE workspaces w
   SET project_id = p.id
  FROM projects p
 WHERE p.workspace_id = w.id
   AND w.project_id IS NULL;

CREATE INDEX IF NOT EXISTS workspaces_project_idx ON workspaces (project_id);

-- ------------------------------------------------------------- collections
-- Collection nests under a workspace.
ALTER TABLE collections ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES workspaces(id) ON DELETE CASCADE;

UPDATE collections c
   SET workspace_id = p.workspace_id
  FROM projects p
 WHERE p.id = c.project_id
   AND c.workspace_id IS NULL;

ALTER TABLE collections ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS collections_workspace_idx ON collections (workspace_id);

-- Legacy edge becomes optional (data preserved).
ALTER TABLE collections ALTER COLUMN project_id DROP NOT NULL;

-- ============================================================================
-- Compatibility triggers: keep the legacy mirrors in sync with the new edges.
-- These let un-migrated queries continue to read projects.workspace_id and
-- collections.project_id correctly.
-- ============================================================================

-- projects BEFORE INSERT: derive organization_id from the legacy workspace edge.
CREATE OR REPLACE FUNCTION app.projects_fill_org() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.workspace_id IS NOT NULL THEN
    SELECT w.organization_id INTO NEW.organization_id
      FROM workspaces w WHERE w.id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_fill_org ON projects;
CREATE TRIGGER projects_fill_org BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION app.projects_fill_org();

-- projects AFTER INSERT: link the referenced workspace back to this project.
CREATE OR REPLACE FUNCTION app.projects_link_workspace() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NOT NULL THEN
    UPDATE workspaces SET project_id = NEW.id
     WHERE id = NEW.workspace_id AND project_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_link_workspace ON projects;
CREATE TRIGGER projects_link_workspace AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION app.projects_link_workspace();

-- workspaces AFTER INSERT: record the project's primary workspace (legacy mirror).
CREATE OR REPLACE FUNCTION app.workspaces_set_primary() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    UPDATE projects SET workspace_id = NEW.id
     WHERE id = NEW.project_id AND workspace_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_set_primary ON workspaces;
CREATE TRIGGER workspaces_set_primary AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION app.workspaces_set_primary();

-- collections BEFORE INSERT/UPDATE: fill whichever edge is missing from the other.
CREATE OR REPLACE FUNCTION app.sync_collection_edges() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NULL AND NEW.project_id IS NOT NULL THEN
    SELECT p.workspace_id INTO NEW.workspace_id
      FROM projects p WHERE p.id = NEW.project_id;
  ELSIF NEW.project_id IS NULL AND NEW.workspace_id IS NOT NULL THEN
    SELECT w.project_id INTO NEW.project_id
      FROM workspaces w WHERE w.id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collections_sync_edges ON collections;
CREATE TRIGGER collections_sync_edges
  BEFORE INSERT OR UPDATE OF workspace_id, project_id ON collections
  FOR EACH ROW EXECUTE FUNCTION app.sync_collection_edges();

COMMIT;
