-- ============================================================================
-- API Hub — 034_mock_scenarios.sql
-- E3 (P3): mock server scenarios and call logs.
--
-- Adds, without touching mock_servers / mock_routes (007):
--   mock_scenarios       named scenario overrides per mock server; a caller
--                        activates one with `X-Mock-Scenario: <name>` or
--                        `?__scenario=<name>` / `?scenario=<name>`.
--   mock_route_responses conditional response variants for a route: a
--                        scenario-specific or default (scenario_id NULL) set
--                        selected by header/query/JSON-body matchers and/or an
--                        ordered stateful sequence.
--   mock_sequence_state  persisted per-(route, scenario) sequence cursor so a
--                        route advances deterministically across requests. The
--                        NULL scenario set is keyed with the all-zero sentinel
--                        (a PK column can never be NULL).
--   mock_call_logs       inbound mock request log (matched route/scenario,
--                        status, duration) with a replay action that re-issues
--                        the stored request against the mock.
--
-- Access is enforced in the route layer (routes/mockScenarios.js) with
-- getProjectAccess, mirroring routes/mockServers.js — these tables do NOT use
-- RLS, exactly like mock_servers / mock_routes.
-- ============================================================================

-- ------------------------------------------------------------------ Scenarios
CREATE TABLE mock_scenarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mock_server_id uuid NOT NULL REFERENCES mock_servers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mock_scenarios_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 100)
);

-- Scenario names are unique per mock server so `X-Mock-Scenario: name` is
-- unambiguous.
CREATE UNIQUE INDEX mock_scenarios_server_name_key
  ON mock_scenarios (mock_server_id, btrim(name));
CREATE INDEX mock_scenarios_server_idx ON mock_scenarios (mock_server_id, name);

COMMENT ON TABLE mock_scenarios IS
  'A named set of mock response overrides a client opts into via X-Mock-Scenario / ?__scenario=.';
COMMENT ON COLUMN mock_scenarios.project_id IS
  'Owning project (denormalised from mock_server_id) so call logs and access checks stay project-keyed.';

-- -------------------------------------------------------- Conditional responses
-- A route's response variants. scenario_id NULL = the default set (always
-- eligible); otherwise the variant is only eligible while that scenario is
-- active. `conditions` is a JSON array of
--   { source: 'header'|'query'|'body', name, operator, value?, caseSensitive? }
-- and every condition must match. `sequence_index` marks an ordered sequence
-- slot (stateful cycling); sequence_mode is 'cycle' (wrap) or 'advance' (clamp
-- on the last response).
CREATE TABLE mock_route_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id       uuid NOT NULL REFERENCES mock_routes(id) ON DELETE CASCADE,
  scenario_id    uuid REFERENCES mock_scenarios(id) ON DELETE CASCADE,
  name           text NOT NULL DEFAULT '',
  priority       integer NOT NULL DEFAULT 0,
  conditions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         integer NOT NULL DEFAULT 200,
  headers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  body           text NOT NULL DEFAULT '',
  delay_ms       integer NOT NULL DEFAULT 0,
  sequence_index integer,
  sequence_mode  text NOT NULL DEFAULT 'cycle',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mock_route_responses_status_check CHECK (status >= 100 AND status <= 599),
  CONSTRAINT mock_route_responses_delay_check CHECK (delay_ms >= 0),
  CONSTRAINT mock_route_responses_seq_index_check CHECK (sequence_index IS NULL OR sequence_index >= 0),
  CONSTRAINT mock_route_responses_seq_mode_check CHECK (sequence_mode IN ('cycle', 'advance'))
);

CREATE INDEX mock_route_responses_route_idx
  ON mock_route_responses (route_id, scenario_id, priority DESC, sequence_index);
CREATE INDEX mock_route_responses_scenario_idx ON mock_route_responses (scenario_id);

COMMENT ON TABLE mock_route_responses IS
  'Conditional / scenario response variants for a mock route. Picked before the static mock_routes row.';
COMMENT ON COLUMN mock_route_responses.conditions IS
  'All-must-match array of {source,name,operator,value?,caseSensitive?} matchers. Empty array matches every request.';
COMMENT ON COLUMN mock_route_responses.sequence_index IS
  'Non-null marks this response as a slot in the route''s ordered stateful sequence.';

-- ------------------------------------------------------------- Sequence state
-- Cursor is the number of times the (route, scenario) sequence has advanced.
-- The default (no scenario) set is stored under the all-zero uuid sentinel
-- because a PRIMARY KEY column cannot be NULL.
CREATE TABLE mock_sequence_state (
  route_id    uuid NOT NULL REFERENCES mock_routes(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  cursor      integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id, scenario_id),
  CONSTRAINT mock_sequence_state_cursor_check CHECK (cursor >= 0)
);

COMMENT ON TABLE mock_sequence_state IS
  'Persisted cursor (calls served) for a route/sequence, keyed by route + scenario (all-zero uuid = default set).';

-- ------------------------------------------------------------------- Call log
CREATE TABLE mock_call_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mock_server_id      uuid NOT NULL REFERENCES mock_servers(id) ON DELETE CASCADE,
  method              text NOT NULL,
  path                text NOT NULL,
  query               jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_headers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_body        text NOT NULL DEFAULT '',
  matched_route_id    uuid REFERENCES mock_routes(id) ON DELETE SET NULL,
  matched_route_path  text,
  matched_response_id uuid REFERENCES mock_route_responses(id) ON DELETE SET NULL,
  matched_scenario_id uuid REFERENCES mock_scenarios(id) ON DELETE SET NULL,
  scenario_name       text,
  status              integer,
  duration_ms         integer NOT NULL DEFAULT 0,
  source              text NOT NULL DEFAULT 'unmatched',
  replayed_from       uuid REFERENCES mock_call_logs(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mock_call_logs_source_check CHECK (source IN ('scenario', 'static', 'unmatched'))
);

CREATE INDEX mock_call_logs_server_idx ON mock_call_logs (mock_server_id, created_at DESC);
CREATE INDEX mock_call_logs_project_idx ON mock_call_logs (project_id, created_at DESC);

COMMENT ON TABLE mock_call_logs IS
  'Inbound mock request log. Retention is capped per mock server by the route layer (MAX_CALL_LOGS_PER_SERVER).';
COMMENT ON COLUMN mock_call_logs.source IS
  'scenario (a conditional/sequence response was served), static (the base mock_routes row), or unmatched (404).';
COMMENT ON COLUMN mock_call_logs.replayed_from IS
  'When set, this row was produced by replaying the referenced call.';

-- ------------------------------------------------------------------- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  mock_scenarios, mock_route_responses, mock_sequence_state, mock_call_logs
  TO app_user;
