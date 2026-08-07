-- 008_workflow_event_triggers.sql
-- Two new automation trigger types plus richer notifications.
--
-- ON_REQUEST      -> run the workflow after a request in the project is executed
--                    (optionally bound to a single watched request).
-- ON_RUN_FAILURE  -> run the workflow when a run in the project fails
--                    (optionally bound to a single watched workflow).
-- Richer notifications: in-app notifications gain a structured payload + an
-- optional deep link, and automations can POST a JSON event to an external
-- webhook URL on failure.

-- Workflow runs triggered by these events record the event type as their trigger.
ALTER TYPE run_trigger ADD VALUE IF NOT EXISTS 'ON_REQUEST';
ALTER TYPE run_trigger ADD VALUE IF NOT EXISTS 'ON_RUN_FAILURE';

-- Widen the allowed trigger types.
ALTER TABLE automations DROP CONSTRAINT automations_trigger_type_check;
ALTER TABLE automations
  ADD CONSTRAINT automations_trigger_type_check
  CHECK (trigger_type IN ('SCHEDULE', 'WEBHOOK', 'ON_REQUEST', 'ON_RUN_FAILURE'));

-- ON_REQUEST: the specific request whose execution fires the automation
-- (NULL = any request in the project). Deleting the watched request removes
-- the automation so it can never fire for a phantom target.
ALTER TABLE automations
  ADD COLUMN event_request_id uuid REFERENCES api_requests(id) ON DELETE CASCADE;

-- ON_RUN_FAILURE: the specific workflow whose failing run fires the automation
-- (NULL = any run in the project).
ALTER TABLE automations
  ADD COLUMN source_workflow_id uuid REFERENCES workflow_chains(id) ON DELETE CASCADE;

-- Optional external endpoint that receives a JSON payload when a run fails.
ALTER TABLE automations
  ADD COLUMN notify_webhook_url text;

-- Richer in-app notifications: structured context + optional deep link.
ALTER TABLE notifications
  ADD COLUMN payload jsonb,
  ADD COLUMN link text;

CREATE INDEX automations_event_request_idx ON automations (event_request_id);
CREATE INDEX automations_source_workflow_idx ON automations (source_workflow_id);
