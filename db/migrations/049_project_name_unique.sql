-- 049_project_name_unique.sql
-- Project names must be unique inside a workspace.
--
-- Workspaces used to allow several projects with the same name (every new
-- workspace auto-created a "Default Project"), which made the tree ambiguous
-- and blocked removing/renaming a specific project. Enforce one project name
-- per workspace, compared case-insensitively so "Payments" and "payments"
-- cannot coexist.
--
-- The index is only created when the table has no pre-existing case-variant
-- duplicates; a dirty database is left untouched rather than failing the whole
-- migration (the API surfaces a 409 conflict on create/rename regardless).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM projects GROUP BY workspace_id, lower(name) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS projects_workspace_lower_name_key
      ON projects (workspace_id, lower(name));
  END IF;
END
$$;
