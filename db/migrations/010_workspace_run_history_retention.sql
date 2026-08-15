-- 010_workspace_run_history_retention.sql
-- Workspace-level run-history retention setting consumed by the purge job.
-- The purge nulls snapshot payloads on expired runs but keeps the aggregate
-- run row (timestamp, user, request, status, duration, assertion results),
-- so trend/audit data survives. Default 90 days, minimum 7, ADMIN-only to
-- change (enforced at the API layer too).

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id              uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  run_history_retention_days integer NOT NULL DEFAULT 90 CHECK (run_history_retention_days >= 7),
  updated_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_settings_select ON workspace_settings FOR SELECT
  USING (app.workspace_readable(workspace_id));

CREATE POLICY workspace_settings_insert ON workspace_settings FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = workspace_settings.workspace_id
      AND wm.user_id = app.current_user_id()
      AND wm.role = 'ADMIN'));

CREATE POLICY workspace_settings_update ON workspace_settings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = workspace_settings.workspace_id
      AND wm.user_id = app.current_user_id()
      AND wm.role = 'ADMIN'))
  WITH CHECK (true);
