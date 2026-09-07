-- ============================================================================
-- API Hub — 020_plan_usage_counter.sql
-- Per-plan usage restrictions (Portal B), L4: calendar-month run counters.
--
-- Runs are metered against the ORG pool (R1): chargeRuns() in
-- backend/src/api/entitlements.js reserves N runs in the current calendar-month
-- bucket before a run is invoked, and returns 403 plan_limit when an enforced
-- runs_per_month limit would be exceeded. The same buckets drive the
-- "runs left this month" usage bars on /api/profile and Portal A /account.
--
-- Counting is org-scoped, not subscription-scoped, so buckets survive a plan
-- change/downgrade without loss (R4 semantics) and reset purely on the
-- calendar month (R5).
--
-- RLS note: the application connects as a privileged role today (bypasses
-- RLS). Policies mirror the 013/016 pattern for a future dedicated app role.
-- ============================================================================

CREATE TABLE plan_usage (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month  date NOT NULL,                          -- first day of the calendar-month bucket
  runs   integer NOT NULL DEFAULT 0 CHECK (runs >= 0),
  PRIMARY KEY (org_id, month)
);

COMMENT ON TABLE plan_usage IS
  'Calendar-month run counters per org pool (R5). Bucket = date_trunc(month). Writes are serialized per (org, month) by chargeRuns().';
COMMENT ON COLUMN plan_usage.runs IS
  'Number of metered runs charged this calendar month (editor send + collection runner + manual workflow runs).';

ALTER TABLE plan_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY plan_usage_select ON plan_usage FOR SELECT
  USING (app.portal_role() IS NOT NULL
         OR EXISTS (SELECT 1 FROM organization_members om
                     WHERE om.org_id = plan_usage.org_id
                       AND om.user_id = app.current_user_id()));
CREATE POLICY plan_usage_insert ON plan_usage FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM organization_members om
                      WHERE om.org_id = plan_usage.org_id
                        AND om.user_id = app.current_user_id()));
CREATE POLICY plan_usage_update ON plan_usage FOR UPDATE
  USING (EXISTS (SELECT 1 FROM organization_members om
                 WHERE om.org_id = plan_usage.org_id
                   AND om.user_id = app.current_user_id()))
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON plan_usage TO app_user;
