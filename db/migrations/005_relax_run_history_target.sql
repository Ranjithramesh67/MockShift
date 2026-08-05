-- ============================================================================
-- API Hub — 005_relax_run_history_target.sql
-- Fixes `DELETE /requests/:id` / `DELETE /workflows/:id` failing with a
-- `run_history_target` check violation once a run exists.
--
-- run_history.request_id / workflow_id use ON DELETE SET NULL, but the
-- original CHECK required exactly one of the two to be non-null, so the FK
-- action (SET NULL) produced rows that violated the constraint and aborted
-- the delete.
--
-- Relax the constraint to forbid *both* being set at once (the app always
-- inserts exactly one target) while allowing both to be NULL, which is the
-- legitimate result of ON DELETE SET NULL. Run history is therefore preserved
-- as an audit trail when the owning request/workflow is deleted.
-- ============================================================================

ALTER TABLE run_history
  DROP CONSTRAINT IF EXISTS run_history_target;

ALTER TABLE run_history
  ADD CONSTRAINT run_history_target CHECK (
    NOT (request_id IS NOT NULL AND workflow_id IS NOT NULL)
  );
