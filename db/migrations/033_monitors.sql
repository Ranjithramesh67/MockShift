-- ============================================================================
-- API Hub — 033_monitors.sql
-- E2 — API monitoring & alerting (P2).
--
-- A *monitor* is a saved synthetic check: it targets either one stored request
-- (api_requests) or one workflow (workflow_chains) in a project and runs on a
-- cron schedule. Every run writes one `monitor_results` row (PASS/FAIL, HTTP
-- status, duration, error). Streak counters + the current UP/DOWN status live
-- on the monitor row so the runner can decide when a failure threshold is
-- crossed (fire alert) and when it recovers (fire recovery).
--
-- Alert transports (coordinator seam): an optional per-monitor webhook URL
-- (`notify_webhook_url`) and an in-app notification to the monitor creator.
-- ============================================================================

CREATE TABLE monitors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                text NOT NULL,
  target_type         text NOT NULL,
  request_id          uuid REFERENCES api_requests(id) ON DELETE CASCADE,
  workflow_id         uuid REFERENCES workflow_chains(id) ON DELETE CASCADE,
  schedule_cron       text NOT NULL,
  failure_threshold   integer NOT NULL DEFAULT 1,
  notify_webhook_url  text,
  enabled             boolean NOT NULL DEFAULT true,
  -- Current health: UNKNOWN until the first check, then UP/DOWN.
  status              text NOT NULL DEFAULT 'UNKNOWN',
  consecutive_failures  integer NOT NULL DEFAULT 0,
  consecutive_successes integer NOT NULL DEFAULT 0,
  -- True once a failure alert has fired and no recovery has happened yet.
  alerted             boolean NOT NULL DEFAULT false,
  last_checked_at     timestamptz,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT monitors_target_type_check CHECK (target_type IN ('REQUEST', 'WORKFLOW')),
  CONSTRAINT monitors_target_check CHECK (
    (target_type = 'REQUEST'  AND request_id  IS NOT NULL AND workflow_id IS NULL) OR
    (target_type = 'WORKFLOW' AND workflow_id IS NOT NULL AND request_id  IS NULL)
  ),
  CONSTRAINT monitors_threshold_check CHECK (failure_threshold >= 1),
  CONSTRAINT monitors_status_check CHECK (status IN ('UNKNOWN', 'UP', 'DOWN')),
  CONSTRAINT monitors_webhook_check CHECK (
    notify_webhook_url IS NULL OR notify_webhook_url ~* '^https?://'
  )
);

CREATE INDEX monitors_project_idx ON monitors (project_id);
CREATE INDEX monitors_due_idx ON monitors (enabled, last_checked_at);

-- One row per executed check. `status` is PASS/FAIL (the check outcome),
-- distinct from the monitor's rolling UP/DOWN health.
CREATE TABLE monitor_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id   uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status       text NOT NULL,
  http_status  integer,
  duration_ms  integer,
  error        text,
  checked_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT monitor_results_status_check CHECK (status IN ('PASS', 'FAIL'))
);

CREATE INDEX monitor_results_monitor_idx ON monitor_results (monitor_id, checked_at DESC);

COMMENT ON TABLE monitors IS
  'Saved synthetic check (request or workflow) run on a cron schedule by monitorRunner.';
COMMENT ON COLUMN monitors.schedule_cron IS
  'Standard 5-field cron (minute hour day-of-month month day-of-week), evaluated in UTC.';
COMMENT ON COLUMN monitors.alerted IS
  'True after a failure alert fired; reset (and a recovery alert sent) on the next passing check.';
COMMENT ON COLUMN monitor_results.status IS
  'PASS or FAIL for this individual check.';

-- ------------------------------------------------------------------ Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON monitors, monitor_results TO app_user;

-- ------------------------------------------------------------- RLS policies
-- Visibility follows the owning project's workspace, mirroring automations.
ALTER TABLE monitors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY monitors_select ON monitors FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects p
                 WHERE p.id = project_id AND app.workspace_readable(p.workspace_id)));
CREATE POLICY monitors_insert ON monitors FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects p
                      WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));
CREATE POLICY monitors_update ON monitors FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects p
                 WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p
                      WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));
CREATE POLICY monitors_delete ON monitors FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects p
                 WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));

-- Results follow their monitor. SELECT is gated on workspace readability;
-- INSERT stays open because the scheduler writes results without a user
-- session context (same pattern as audit_logs / notifications).
CREATE POLICY monitor_results_select ON monitor_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM monitors m
                 JOIN projects p ON p.id = m.project_id
                 WHERE m.id = monitor_id AND app.workspace_readable(p.workspace_id)));
CREATE POLICY monitor_results_insert ON monitor_results FOR INSERT
  WITH CHECK (true);
