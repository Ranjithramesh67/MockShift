-- ============================================================================
-- API Hub — 001_init.sql
-- Authoritative DDL for the API orchestration platform.
--
-- Layered security model:
--   1. RBAC roles (ADMIN/EDITOR/VIEWER) stored per membership row.
--   2. Row-Level Security (RLS) enforced in PostgreSQL so even a compromised
--      ORM query cannot reach rows the caller is not permitted to touch.
--   3. Variable values encrypted at rest via pgcrypto (pgp_sym_encrypt). The
--      vault key is injected per-session with
--      SET LOCAL app.vault_key = '<key from KMS/ENV>' and is never persisted.
--
-- The application sets session context before every request:
--   SET LOCAL app.current_user_id = '<uuid>';
-- (plus app.vault_key for variable decryption).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- Enums
CREATE TYPE role          AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');
CREATE TYPE visibility    AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE http_method   AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS');
CREATE TYPE body_type     AS ENUM ('NONE', 'JSON', 'FORM_URLENCODED', 'MULTIPART', 'RAW_TEXT', 'GRAPHQL');
CREATE TYPE variable_scope AS ENUM ('GLOBAL', 'WORKSPACE', 'ENVIRONMENT', 'REQUEST');
CREATE TYPE run_trigger   AS ENUM ('MANUAL', 'CRON', 'WEBHOOK', 'WORKFLOW', 'REGRESSION');
CREATE TYPE run_status    AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- ------------------------------------------------------------- Auth/RBAC
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE team_members (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    role NOT NULL,
  UNIQUE (team_id, user_id)
);

CREATE TABLE organizations (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE organization_members (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    role NOT NULL,
  UNIQUE (org_id, user_id)
);

-- ------------------------------------------------------- Workspace layer
CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  visibility      visibility NOT NULL DEFAULT 'PRIVATE'
);

CREATE TABLE workspace_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         role NOT NULL,
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL
);

-- -------------------------------------------------------------- Content
CREATE TABLE collections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL
);

CREATE TABLE api_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name          text NOT NULL,
  method        http_method NOT NULL DEFAULT 'GET',
  url           text NOT NULL,
  headers       jsonb NOT NULL DEFAULT '[]'::jsonb,
  query_params  jsonb NOT NULL DEFAULT '[]'::jsonb,
  body_type     body_type NOT NULL DEFAULT 'NONE',
  body_json     jsonb,
  body_text     text
);

CREATE TABLE environments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  is_active    boolean NOT NULL DEFAULT false
);

-- Encrypted variables (cascade levels: GLOBAL > WORKSPACE > ENVIRONMENT > REQUEST).
CREATE TABLE variables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key              text NOT NULL,
  scope            variable_scope NOT NULL,
  is_secret        boolean NOT NULL DEFAULT true,
  -- Secrets: pgp_sym_encrypt() output (bytea). Non-secrets: plaintext.
  value_encrypted  bytea,
  value_plain      text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  workspace_id   uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid REFERENCES environments(id) ON DELETE CASCADE,
  request_id     uuid REFERENCES api_requests(id) ON DELETE CASCADE,

  -- Exactly one representation of the value.
  CONSTRAINT variables_value_repr CHECK (
    (is_secret AND value_encrypted IS NOT NULL AND value_plain IS NULL) OR
    (NOT is_secret AND value_plain IS NOT NULL AND value_encrypted IS NULL)
  ),
  -- Exactly one FK target, matching the declared scope.
  CONSTRAINT variables_scope_target CHECK (
    (scope = 'GLOBAL'     AND workspace_id IS NULL     AND environment_id IS NULL     AND request_id IS NULL) OR
    (scope = 'WORKSPACE'  AND workspace_id IS NOT NULL AND environment_id IS NULL     AND request_id IS NULL) OR
    (scope = 'ENVIRONMENT' AND environment_id IS NOT NULL AND workspace_id IS NULL    AND request_id IS NULL) OR
    (scope = 'REQUEST'    AND request_id IS NOT NULL  AND workspace_id IS NULL       AND environment_id IS NULL)
  )
);

-- Key uniqueness per scope.
CREATE UNIQUE INDEX variables_global_key_uidx      ON variables (key)            WHERE scope = 'GLOBAL';
CREATE UNIQUE INDEX variables_workspace_key_uidx   ON variables (workspace_id, key) WHERE scope = 'WORKSPACE';
CREATE UNIQUE INDEX variables_environment_key_uidx ON variables (environment_id, key) WHERE scope = 'ENVIRONMENT';
CREATE UNIQUE INDEX variables_request_key_uidx     ON variables (request_id, key)    WHERE scope = 'REQUEST';

-- ----------------------------------------------------------- Automation
CREATE TABLE workflow_chains (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  definition jsonb NOT NULL
);

-- ---------------------------------------------------------------- Logs
CREATE TABLE run_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid REFERENCES api_requests(id) ON DELETE SET NULL,
  workflow_id       uuid REFERENCES workflow_chains(id) ON DELETE SET NULL,
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  trigger           run_trigger NOT NULL,
  status            run_status NOT NULL DEFAULT 'PENDING',
  request_snapshot  jsonb,
  response_snapshot jsonb,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  CONSTRAINT run_history_target CHECK (
    (request_id IS NOT NULL AND workflow_id IS NULL) OR
    (workflow_id IS NOT NULL AND request_id IS NULL)
  )
);

CREATE INDEX run_history_request_idx  ON run_history (request_id, started_at DESC);
CREATE INDEX run_history_workflow_idx ON run_history (workflow_id, started_at DESC);
CREATE INDEX run_history_user_idx     ON run_history (user_id, started_at DESC);

CREATE TABLE test_results (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES run_history(id) ON DELETE CASCADE,
  test_name  text NOT NULL,
  passed     boolean NOT NULL,
  assertions jsonb,
  error      text
);

CREATE INDEX test_results_run_idx ON test_results (run_id);

-- ============================================================================
-- RLS infrastructure
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS app;

-- Session context set by the application on every authenticated request.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.vault_key() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.vault_key', true), '')
$$;

-- Membership helpers (security invoker -> RLS applies inside).
CREATE OR REPLACE FUNCTION app.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM organization_members
                 WHERE user_id = _user_id AND org_id = _org_id);
$$;

CREATE OR REPLACE FUNCTION app.is_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM organization_members
                 WHERE user_id = _user_id AND org_id = _org_id AND role = 'ADMIN');
$$;

CREATE OR REPLACE FUNCTION app.workspace_role(_user_id uuid, _workspace_id uuid)
RETURNS role LANGUAGE sql STABLE AS $$
  SELECT role FROM workspace_members
  WHERE user_id = _user_id AND workspace_id = _workspace_id
  LIMIT 1;
$$;

-- A user may READ a workspace if it is PUBLIC within their org, or they are a member.
CREATE OR REPLACE FUNCTION app.workspace_readable(_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.id = _workspace_id
      AND app.is_org_member(app.current_user_id(), w.organization_id)
      AND (w.visibility = 'PUBLIC' OR app.workspace_role(app.current_user_id(), w.id) IS NOT NULL)
  );
$$;

-- Only ADMIN/EDITOR workspace members may WRITE.
CREATE OR REPLACE FUNCTION app.can_mutate_workspace(_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.workspace_role(app.current_user_id(), _workspace_id) IN ('ADMIN', 'EDITOR');
$$;

-- Write authority for a variable row, based on its scope target.
CREATE OR REPLACE FUNCTION app.can_write_variable(
  _workspace_id uuid, _environment_id uuid, _request_id uuid,
  _scope variable_scope, _created_by uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE _scope
    WHEN 'GLOBAL'      THEN app.current_user_id() = _created_by
    WHEN 'WORKSPACE'   THEN app.can_mutate_workspace(_workspace_id)
    WHEN 'ENVIRONMENT' THEN EXISTS (
      SELECT 1 FROM environments e
      WHERE e.id = _environment_id AND app.can_mutate_workspace(e.workspace_id))
    WHEN 'REQUEST'     THEN EXISTS (
      SELECT 1 FROM api_requests ar
      JOIN collections c  ON c.id  = ar.collection_id
      JOIN projects p     ON p.id  = c.project_id
      WHERE ar.id = _request_id AND app.can_mutate_workspace(p.workspace_id))
  END;
$$;

-- Read authority for a variable row (scope-aware; GLOBAL = own variables).
CREATE OR REPLACE FUNCTION app.can_read_variable(
  _workspace_id uuid, _environment_id uuid, _request_id uuid, _scope variable_scope, _created_by uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE _scope
    WHEN 'GLOBAL'      THEN app.current_user_id() = _created_by
    WHEN 'WORKSPACE'   THEN app.workspace_readable(_workspace_id)
    WHEN 'ENVIRONMENT' THEN EXISTS (
      SELECT 1 FROM environments e
      WHERE e.id = _environment_id AND app.workspace_readable(e.workspace_id))
    WHEN 'REQUEST'     THEN EXISTS (
      SELECT 1 FROM api_requests ar
      JOIN collections c ON c.id = ar.collection_id
      JOIN projects p    ON p.id = c.project_id
      WHERE ar.id = _request_id AND app.workspace_readable(p.workspace_id))
  END;
$$;

-- ============================================================================
-- RLS policies
-- ============================================================================

-- Workload role used by tests (and the app's DB user in production).
DROP ROLE IF EXISTS app_user;
CREATE ROLE app_user NOLOGIN;
GRANT USAGE ON SCHEMA public, app TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, app TO app_user;

ALTER TABLE workspaces           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE environments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE variables            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_chains      ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_history          ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_results         ENABLE ROW LEVEL SECURITY;

-- --- workspaces ------------------------------------------------------------
-- NOTE: this policy must NOT call app.workspace_readable(id) — that helper
-- queries workspaces itself, which would re-enter this policy (recursion).
-- The inline check only touches non-RLS membership tables, so it terminates.
CREATE POLICY workspaces_select ON workspaces FOR SELECT
  USING (app.is_org_member(app.current_user_id(), organization_id)
         AND (visibility = 'PUBLIC'
              OR app.workspace_role(app.current_user_id(), id) IS NOT NULL));

CREATE POLICY workspaces_insert ON workspaces FOR INSERT
  WITH CHECK (app.is_org_admin(app.current_user_id(), organization_id));

CREATE POLICY workspaces_update ON workspaces FOR UPDATE
  USING (app.workspace_role(app.current_user_id(), id) = 'ADMIN')
  WITH CHECK (app.workspace_role(app.current_user_id(), id) = 'ADMIN');

CREATE POLICY workspaces_delete ON workspaces FOR DELETE
  USING (app.workspace_role(app.current_user_id(), id) = 'ADMIN');

-- --- projects --------------------------------------------------------------
CREATE POLICY projects_select ON projects FOR SELECT
  USING (app.workspace_readable(workspace_id));

CREATE POLICY projects_insert ON projects FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));

CREATE POLICY projects_update ON projects FOR UPDATE
  USING (app.can_mutate_workspace(workspace_id))
  WITH CHECK (app.can_mutate_workspace(workspace_id));

CREATE POLICY projects_delete ON projects FOR DELETE
  USING (app.can_mutate_workspace(workspace_id));

-- --- collections -----------------------------------------------------------
CREATE POLICY collections_select ON collections FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.workspace_readable(p.workspace_id)));

CREATE POLICY collections_insert ON collections FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY collections_update ON collections FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY collections_delete ON collections FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));

-- --- api_requests ----------------------------------------------------------
CREATE POLICY api_requests_select ON api_requests FOR SELECT
  USING (EXISTS (SELECT 1 FROM collections c
                 JOIN projects p ON p.id = c.project_id
                 WHERE c.id = collection_id AND app.workspace_readable(p.workspace_id)));

CREATE POLICY api_requests_insert ON api_requests FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM collections c
                      JOIN projects p ON p.id = c.project_id
                      WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY api_requests_update ON api_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM collections c
                 JOIN projects p ON p.id = c.project_id
                 WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM collections c
                      JOIN projects p ON p.id = c.project_id
                      WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY api_requests_delete ON api_requests FOR DELETE
  USING (EXISTS (SELECT 1 FROM collections c
                 JOIN projects p ON p.id = c.project_id
                 WHERE c.id = collection_id AND app.can_mutate_workspace(p.workspace_id)));

-- --- environments ----------------------------------------------------------
CREATE POLICY environments_select ON environments FOR SELECT
  USING (app.workspace_readable(workspace_id));

CREATE POLICY environments_insert ON environments FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));

CREATE POLICY environments_update ON environments FOR UPDATE
  USING (app.can_mutate_workspace(workspace_id))
  WITH CHECK (app.can_mutate_workspace(workspace_id));

CREATE POLICY environments_delete ON environments FOR DELETE
  USING (app.can_mutate_workspace(workspace_id));

-- --- variables -------------------------------------------------------------
CREATE POLICY variables_select ON variables FOR SELECT
  USING (app.can_read_variable(workspace_id, environment_id, request_id, scope, created_by));

CREATE POLICY variables_insert ON variables FOR INSERT
  WITH CHECK (app.can_write_variable(workspace_id, environment_id, request_id, scope, created_by));

CREATE POLICY variables_update ON variables FOR UPDATE
  USING (app.can_write_variable(workspace_id, environment_id, request_id, scope, created_by))
  WITH CHECK (app.can_write_variable(workspace_id, environment_id, request_id, scope, created_by));

CREATE POLICY variables_delete ON variables FOR DELETE
  USING (app.can_write_variable(workspace_id, environment_id, request_id, scope, created_by));

-- --- workflow_chains -------------------------------------------------------
CREATE POLICY workflow_chains_select ON workflow_chains FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.workspace_readable(p.workspace_id)));

CREATE POLICY workflow_chains_insert ON workflow_chains FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY workflow_chains_update ON workflow_chains FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY workflow_chains_delete ON workflow_chains FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND app.can_mutate_workspace(p.workspace_id)));

-- --- run_history -----------------------------------------------------------
-- Anyone who can view the parent request/workflow may read or create a run.
CREATE POLICY run_history_select ON run_history FOR SELECT
  USING (
    (request_id IS NOT NULL AND EXISTS (SELECT 1 FROM api_requests ar
                                        JOIN collections c ON c.id = ar.collection_id
                                        JOIN projects p    ON p.id = c.project_id
                                        WHERE ar.id = request_id AND app.workspace_readable(p.workspace_id)))
    OR
    (workflow_id IS NOT NULL AND EXISTS (SELECT 1 FROM workflow_chains wc
                                         JOIN projects p ON p.id = wc.project_id
                                         WHERE wc.id = workflow_id AND app.workspace_readable(p.workspace_id)))
  );

CREATE POLICY run_history_insert ON run_history FOR INSERT
  WITH CHECK (
    (request_id IS NOT NULL AND EXISTS (SELECT 1 FROM api_requests ar
                                        JOIN collections c ON c.id = ar.collection_id
                                        JOIN projects p    ON p.id = c.project_id
                                        WHERE ar.id = request_id AND app.workspace_readable(p.workspace_id)))
    OR
    (workflow_id IS NOT NULL AND EXISTS (SELECT 1 FROM workflow_chains wc
                                         JOIN projects p ON p.id = wc.project_id
                                         WHERE wc.id = workflow_id AND app.workspace_readable(p.workspace_id)))
  );

CREATE POLICY run_history_update ON run_history FOR UPDATE
  USING (EXISTS (SELECT 1 FROM workspace_members wm
                 WHERE wm.user_id = app.current_user_id()
                   AND wm.role IN ('ADMIN', 'EDITOR')
                   AND wm.workspace_id = (
                     SELECT p.workspace_id FROM api_requests ar
                     JOIN collections c ON c.id = ar.collection_id
                     JOIN projects p    ON p.id = c.project_id
                     WHERE ar.id = run_history.request_id
                     UNION
                     SELECT p.workspace_id FROM workflow_chains wc
                     JOIN projects p ON p.id = wc.project_id
                     WHERE wc.id = run_history.workflow_id)))
  WITH CHECK (true);

-- --- test_results ----------------------------------------------------------
CREATE POLICY test_results_select ON test_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM run_history rh WHERE rh.id = run_id
                 AND app.workspace_role(app.current_user_id(), (
                     SELECT p.workspace_id FROM api_requests ar
                     JOIN collections c ON c.id = ar.collection_id
                     JOIN projects p    ON p.id = c.project_id
                     WHERE ar.id = rh.request_id LIMIT 1)) IS NOT NULL));

CREATE POLICY test_results_insert ON test_results FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM run_history rh WHERE rh.id = run_id
                 AND app.workspace_role(app.current_user_id(), (
                     SELECT p.workspace_id FROM api_requests ar
                     JOIN collections c ON c.id = ar.collection_id
                     JOIN projects p    ON p.id = c.project_id
                     WHERE ar.id = rh.request_id LIMIT 1)) IS NOT NULL));

-- ============================================================================
-- Runtime helper: variable cascade resolver.
-- Priority (highest first): REQUEST > ENVIRONMENT > WORKSPACE > GLOBAL.
-- RLS applies (security invoker): users only ever resolve variables they
-- can read, so private-workspace secrets never leak into a public context.
-- ============================================================================
CREATE OR REPLACE FUNCTION app.resolve_variables(_request_id uuid, _environment_id uuid)
RETURNS TABLE (key text, value text, source text)
LANGUAGE plpgsql STABLE AS $$
DECLARE _ws uuid;
BEGIN
  SELECT p.workspace_id INTO _ws
  FROM api_requests ar
  JOIN collections c ON c.id = ar.collection_id
  JOIN projects p    ON p.id = c.project_id
  WHERE ar.id = _request_id;

  IF _ws IS NULL THEN
    SELECT workspace_id INTO _ws FROM environments WHERE id = _environment_id;
  END IF;

  RETURN QUERY
  WITH resolved AS (
    SELECT s.key, s.val, s.lvl,
           CASE s.lvl WHEN 'REQUEST' THEN 1 WHEN 'ENVIRONMENT' THEN 2 WHEN 'WORKSPACE' THEN 3 ELSE 4 END AS pri
    FROM (
      SELECT v.key,
             CASE WHEN v.is_secret THEN pgp_sym_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'GLOBAL' AS lvl
      FROM variables v WHERE v.scope = 'GLOBAL'
      UNION ALL
      SELECT v.key,
             CASE WHEN v.is_secret THEN pgp_sym_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'WORKSPACE' AS lvl
      FROM variables v WHERE v.scope = 'WORKSPACE' AND v.workspace_id = _ws
      UNION ALL
      SELECT v.key,
             CASE WHEN v.is_secret THEN pgp_sym_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'ENVIRONMENT' AS lvl
      FROM variables v WHERE v.scope = 'ENVIRONMENT' AND v.environment_id = _environment_id
      UNION ALL
      SELECT v.key,
             CASE WHEN v.is_secret THEN pgp_sym_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'REQUEST' AS lvl
      FROM variables v WHERE v.scope = 'REQUEST' AND v.request_id = _request_id
    ) s
  )
  SELECT DISTINCT ON (resolved.key) resolved.key, resolved.val, resolved.lvl
  FROM resolved
  ORDER BY resolved.key, resolved.pri;
END;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_variables(uuid, uuid) TO app_user;
