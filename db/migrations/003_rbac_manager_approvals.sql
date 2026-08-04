-- ============================================================================
-- API Hub — 003_rbac_manager_approvals.sql
-- Project-scoped governance additions:
--   1. New global role MANAGER (sits between EDITOR and ADMIN).
--   2. project_managers: users assigned to manage a project.
--   3. project_members: users granted explicit project-level access.
--   4. access_requests: pending requests to join a project, approved/denied
--      by a project manager or admin.
--   5. audit_logs: immutable trail of governance/admin actions.
--   6. automations: scheduled (cron) or webhook-triggered workflow runs.
--   7. notifications: in-app messages (e.g. failed automated runs).
--
-- RLS note: mirrors the pattern in 001/002. Policies are provided for
-- consistency; the application connects as a privileged role for now.
-- ============================================================================

ALTER TYPE role ADD VALUE IF NOT EXISTS 'MANAGER';

-- ------------------------------------------------------ Project management
ALTER TABLE workflow_chains
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- A manager controls an assigned project: approves access requests and can
-- view/manage its content, members and runs. Admins assign/remove managers.
CREATE TABLE project_managers (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- Users explicitly granted project-level access (beyond workspace/team roles).
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       role NOT NULL DEFAULT 'VIEWER',
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- Requests to join a project. One pending request per (project, user).
CREATE TABLE access_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role         role NOT NULL DEFAULT 'VIEWER',
  reason       text,
  status       text NOT NULL DEFAULT 'PENDING',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  UNIQUE (project_id, user_id),
  CONSTRAINT access_requests_status_check CHECK (status IN ('PENDING', 'APPROVED', 'DENIED'))
);

-- --------------------------------------------------------------- Audit log
-- Every governance/admin mutation records a row here for the admin/manager
-- audit views. entity_type examples: user, project, workspace, team,
-- automation, access_request, run.
CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  action      text NOT NULL,
  detail      jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- Automations
-- A SCHEDULE automation runs a workflow on a cron expression; a WEBHOOK
-- automation is triggered by POSTing to /api/webhooks/<webhook_token>.
CREATE TABLE automations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id      uuid NOT NULL REFERENCES workflow_chains(id) ON DELETE CASCADE,
  trigger_type     text NOT NULL,
  schedule_cron    text,
  webhook_token    text UNIQUE,
  input_vars       jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify_on_failure boolean NOT NULL DEFAULT true,
  enabled          boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_run_at      timestamptz,
  last_status      run_status,
  CONSTRAINT automations_trigger_type_check CHECK (trigger_type IN ('SCHEDULE', 'WEBHOOK')),
  CONSTRAINT automations_cron_check CHECK (trigger_type <> 'SCHEDULE' OR schedule_cron IS NOT NULL),
  CONSTRAINT automations_token_check CHECK (trigger_type <> 'WEBHOOK' OR webhook_token IS NOT NULL)
);

-- In-app notifications (e.g. an automated workflow run failed).
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text,
  kind       text NOT NULL DEFAULT 'info',
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  project_managers, project_members, access_requests,
  audit_logs, automations, notifications
  TO app_user;

-- --------------------------------------------------------------- Indexes
CREATE INDEX project_managers_user_idx  ON project_managers (user_id);
CREATE INDEX project_members_user_idx   ON project_members (user_id);
CREATE INDEX access_requests_project_idx ON access_requests (project_id);
CREATE INDEX access_requests_user_idx   ON access_requests (user_id);
CREATE INDEX access_requests_status_idx ON access_requests (status);
CREATE INDEX audit_logs_actor_idx       ON audit_logs (actor_id);
CREATE INDEX audit_logs_entity_idx      ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created_idx     ON audit_logs (created_at DESC);
CREATE INDEX automations_project_idx    ON automations (project_id);
CREATE INDEX automations_workflow_idx   ON automations (workflow_id);
CREATE INDEX notifications_user_idx     ON notifications (user_id, read);

-- ------------------------------------------------------- RLS helpers/policies
CREATE OR REPLACE FUNCTION app.is_project_manager(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_managers pm
    WHERE pm.project_id = _project_id AND pm.user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.is_project_manager(uuid, uuid) TO app_user;

ALTER TABLE project_managers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;

-- Managers: rows for projects they manage.
CREATE POLICY project_managers_select ON project_managers FOR SELECT
  USING (app.is_project_manager(app.current_user_id(), project_id));
CREATE POLICY project_managers_insert ON project_managers FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role = 'ADMIN'));
CREATE POLICY project_managers_delete ON project_managers FOR DELETE
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role = 'ADMIN'));

-- Members: managers of the project or admins can view.
CREATE POLICY project_members_select ON project_members FOR SELECT
  USING (
    app.is_project_manager(app.current_user_id(), project_id)
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role = 'ADMIN')
  );
CREATE POLICY project_members_insert ON project_members FOR INSERT
  WITH CHECK (
    app.is_project_manager(app.current_user_id(), project_id)
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role = 'ADMIN')
  );
CREATE POLICY project_members_delete ON project_members FOR DELETE
  USING (
    app.is_project_manager(app.current_user_id(), project_id)
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role = 'ADMIN')
  );

-- Access requests: requesters see their own; managers/admins see requests for
-- projects they manage.
CREATE POLICY access_requests_select ON access_requests FOR SELECT
  USING (
    user_id = app.current_user_id()
    OR app.is_project_manager(app.current_user_id(), project_id)
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role = 'ADMIN')
  );
CREATE POLICY access_requests_insert ON access_requests FOR INSERT
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY access_requests_update ON access_requests FOR UPDATE
  USING (
    app.is_project_manager(app.current_user_id(), project_id)
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role = 'ADMIN')
  );

-- Audit logs: admins and managers see everything (managers are additionally
-- scoped by the application layer).
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = app.current_user_id() AND u.role IN ('ADMIN', 'MANAGER'))
  );
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (true);

-- Automations: managers/admins/editors of the owning workspace.
CREATE POLICY automations_select ON automations FOR SELECT
  USING (EXISTS (SELECT 1 FROM workflow_chains wc
                 JOIN projects p ON p.id = wc.project_id
                 WHERE wc.id = automations.workflow_id
                   AND (app.can_mutate_workspace(p.workspace_id)
                        OR app.is_project_manager(app.current_user_id(), p.id))));
CREATE POLICY automations_insert ON automations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM workflow_chains wc
                      JOIN projects p ON p.id = wc.project_id
                      WHERE wc.id = workflow_id
                        AND (app.can_mutate_workspace(p.workspace_id)
                             OR app.is_project_manager(app.current_user_id(), p.id))));
CREATE POLICY automations_update ON automations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM workflow_chains wc
                 JOIN projects p ON p.id = wc.project_id
                 WHERE wc.id = workflow_id
                   AND (app.can_mutate_workspace(p.workspace_id)
                        OR app.is_project_manager(app.current_user_id(), p.id))))
  WITH CHECK (EXISTS (SELECT 1 FROM workflow_chains wc
                      JOIN projects p ON p.id = wc.project_id
                      WHERE wc.id = workflow_id
                        AND (app.can_mutate_workspace(p.workspace_id)
                             OR app.is_project_manager(app.current_user_id(), p.id))));
CREATE POLICY automations_delete ON automations FOR DELETE
  USING (EXISTS (SELECT 1 FROM workflow_chains wc
                 JOIN projects p ON p.id = wc.project_id
                 WHERE wc.id = workflow_id
                   AND (app.can_mutate_workspace(p.workspace_id)
                        OR app.is_project_manager(app.current_user_id(), p.id))));

-- Notifications: only the owner.
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (true);
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (user_id = app.current_user_id());
