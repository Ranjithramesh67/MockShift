-- ============================================================================
-- 058_split_multi_project_workspaces.sql
--
-- After 057 the canonical hierarchy is organization -> project -> workspace.
-- A workspace now nests under exactly one project, but the 057 back-fill could
-- only assign a workspace to one of its (possibly several) legacy projects.
-- Projects that shared a workspace therefore ended up with no workspace of
-- their own (`GET /projects/:id/content` returned an empty workspace list).
--
-- This migration is ADDITIVE and non-destructive: for every project that does
-- not yet own a workspace it creates one, moves that project's collections
-- into it, and mirrors the source workspace's members and team grants. No rows
-- or columns are removed.
--
-- Idempotent: projects that already own a workspace are skipped, so re-running
-- is a no-op.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  p            RECORD;
  src          RECORD;
  new_ws       uuid;
BEGIN
  FOR p IN
    SELECT id, name, organization_id, workspace_id
      FROM projects
     WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.project_id = projects.id)
  LOOP
    SELECT id, organization_id, visibility
      INTO src
      FROM workspaces
     WHERE id = p.workspace_id;

    INSERT INTO workspaces (name, organization_id, visibility, project_id)
    VALUES (
      p.name,
      COALESCE(src.organization_id, p.organization_id),
      COALESCE(src.visibility, 'PRIVATE'),
      p.id
    )
    RETURNING id INTO new_ws;

    -- Collections of this project followed the legacy workspace; re-home them.
    UPDATE collections SET workspace_id = new_ws WHERE project_id = p.id;

    -- Preserve access: copy members and team grants from the shared workspace.
    IF src.id IS NOT NULL THEN
      INSERT INTO workspace_members (workspace_id, user_id, role)
      SELECT new_ws, user_id, role
        FROM workspace_members
       WHERE workspace_id = src.id
      ON CONFLICT (workspace_id, user_id) DO NOTHING;

      INSERT INTO workspace_teams (workspace_id, team_id, role)
      SELECT new_ws, team_id, role
        FROM workspace_teams
       WHERE workspace_id = src.id
      ON CONFLICT (workspace_id, team_id) DO NOTHING;
    END IF;

    -- Keep the legacy mirror pointing at a workspace that belongs to the project.
    UPDATE projects SET workspace_id = new_ws WHERE id = p.id;
  END LOOP;
END;
$$;

COMMIT;
