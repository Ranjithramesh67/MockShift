-- ============================================================================
-- API Hub — 040_menu_settings.sql
-- Admin-configurable menu (feature) visibility.
--
-- A platform admin may disable a rail feature either for a whole organization
-- (all of its projects) or for one specific project. The table stores OVERRIDES
-- ONLY: the absence of a row means the feature is enabled (default-on).
--
-- Scope invariants:
--   scope='org'     -> organization_id set, project_id null
--   scope='project' -> project_id set,      organization_id null
--
-- When both an org row and a project row exist for the same menu_key, the
-- project row wins (more specific). Merge order lives in menuAccess.js.
-- ============================================================================

CREATE TABLE menu_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_key        text NOT NULL,
  scope           text NOT NULL CHECK (scope IN ('org', 'project')),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT true,
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_settings_scope_target CHECK (
    (scope = 'org'     AND organization_id IS NOT NULL AND project_id IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL      AND organization_id IS NULL)
  )
);

-- One override per (menu, org) and per (menu, project).
CREATE UNIQUE INDEX menu_settings_org_uidx
  ON menu_settings (menu_key, organization_id) WHERE scope = 'org';
CREATE UNIQUE INDEX menu_settings_project_uidx
  ON menu_settings (menu_key, project_id) WHERE scope = 'project';

CREATE INDEX menu_settings_organization_idx ON menu_settings (organization_id) WHERE scope = 'org';
CREATE INDEX menu_settings_project_idx      ON menu_settings (project_id)      WHERE scope = 'project';

COMMENT ON TABLE menu_settings IS
  'Per-org / per-project feature (menu) enable/disable overrides. No row = enabled.';
COMMENT ON COLUMN menu_settings.menu_key IS
  'Toggleable feature id (teams, docs, copilot, ...). Validated in the app; not enumerated here so new menus need no migration.';
COMMENT ON COLUMN menu_settings.enabled IS
  'false hides the rail item and makes requireMenuEnabled() reject API access for the scoped org/project.';

-- Defense in depth (the app connects as a privileged role today; real authz is
-- in the admin route). Members of the owning org may read the effective flag.
ALTER TABLE menu_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_settings_select ON menu_settings FOR SELECT
  USING (
    (scope = 'org' AND app.is_org_member(app.current_user_id(), organization_id)) OR
    (scope = 'project' AND EXISTS (
       SELECT 1 FROM projects p
         JOIN workspaces w ON w.id = p.workspace_id
        WHERE p.id = menu_settings.project_id
          AND app.is_org_member(app.current_user_id(), w.organization_id)
    ))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON menu_settings TO app_user;
