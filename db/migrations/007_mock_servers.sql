-- 007_mock_servers.sql
-- Per-project mock API server: a set of routes (method + path + response)
-- that are served by the API at /mock/:projectId/* so requests can be pointed
-- at the mock server instead of a real upstream.

CREATE TABLE mock_servers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE TABLE mock_routes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_server_id uuid NOT NULL REFERENCES mock_servers(id) ON DELETE CASCADE,
  method         text NOT NULL DEFAULT 'GET',
  path           text NOT NULL,
  status         integer NOT NULL DEFAULT 200,
  headers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  body           text NOT NULL DEFAULT '',
  delay_ms       integer NOT NULL DEFAULT 0,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mock_routes_status_check CHECK (status >= 100 AND status <= 599),
  CONSTRAINT mock_routes_delay_check CHECK (delay_ms >= 0)
);

CREATE INDEX mock_routes_server_idx ON mock_routes (mock_server_id, sort_order);
