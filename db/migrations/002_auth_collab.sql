-- ============================================================================
-- API Hub — 002_auth_collab.sql
-- Collaborative platform additions:
--   1. Global user role + active flag (drives the admin panel).
--   2. Teams belong to an organization; teams can be shared into workspaces
--      (workspace_teams) so members gain access to a workspace.
--   3. API type on requests (REST / SOAP / GRAPHQL / AUTH token provider).
--   4. auth_providers: folder-level token source. A collection may point at an
--      AUTH-type request; its response is read at token_path and injected as
--      `header_prefix + token` into every request in the folder.
--
-- RLS note: the application connects as a privileged role that bypasses RLS
-- for now. Policies for the new tables are intentionally omitted until a
-- dedicated app role is introduced; existing content tables keep their RLS.
-- ============================================================================

CREATE TYPE api_type AS ENUM ('REST', 'SOAP', 'GRAPHQL', 'AUTH');

-- ------------------------------------------------------------- Users / RBAC
-- Global role used for admin panel privileges; membership tables keep their
-- own per-scope roles.
ALTER TABLE users
  ADD COLUMN role     role    NOT NULL DEFAULT 'EDITOR',
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------- Teams
ALTER TABLE teams
  ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- ------------------------------------------------------------ Requests
ALTER TABLE api_requests
  ADD COLUMN api_type api_type NOT NULL DEFAULT 'REST';

-- --------------------------------------------------------- Workspace sharing
-- A team shared into a workspace grants every team member the given role.
CREATE TABLE workspace_teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  role         role NOT NULL DEFAULT 'EDITOR',
  UNIQUE (workspace_id, team_id)
);

-- ------------------------------------------------------- Folder auth provider
-- One auth source per collection. token_request_id points at an AUTH-type
-- request inside the same workspace; its JSON body is read at token_path.
CREATE TABLE auth_providers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    uuid NOT NULL UNIQUE REFERENCES collections(id) ON DELETE CASCADE,
  auth_type        text NOT NULL DEFAULT 'NONE',
  token_request_id uuid REFERENCES api_requests(id) ON DELETE SET NULL,
  token_path       text NOT NULL DEFAULT '',
  header_key       text NOT NULL DEFAULT 'Authorization',
  header_prefix    text NOT NULL DEFAULT 'Bearer',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_providers_type_check CHECK (
    auth_type IN ('NONE', 'BASIC', 'BEARER_TOKEN', 'OAUTH2')
  )
);

-- ------------------------------------------------------------------- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_teams  TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_providers   TO app_user;

CREATE INDEX workspace_teams_workspace_idx ON workspace_teams (workspace_id);
CREATE INDEX workspace_teams_team_idx      ON workspace_teams (team_id);
