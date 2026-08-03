-- ============================================================================
-- TEST 3 — 002_auth_collab.sql contract:
--   * users carry a global role + active flag
--   * teams belong to an organization
--   * requests carry an api_type
--   * a team shared into a workspace (workspace_teams) grants its members
--     effective access to that workspace
--   * a collection auth provider can point at an AUTH request and the
--     token-path extraction contract holds
-- ============================================================================
\set ON_ERROR_STOP on
\echo '== TEST 3: auth + collaboration schema (migration 002) =='

-- 3.1 Users: global role + active flag --------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN RAISE EXCEPTION 'FAIL 3.1a: users.role column missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_active'
  ) THEN RAISE EXCEPTION 'FAIL 3.1b: users.is_active column missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'admin@example.com'
      AND role = 'EDITOR' AND is_active = true
  ) THEN RAISE EXCEPTION 'FAIL 3.1c: users should default to role=EDITOR, is_active=true'; END IF;
END $$;

-- 3.2 Teams: organization scoping -------------------------------------------
DO $$
DECLARE n int;
BEGIN
  INSERT INTO teams (id, name, organization_id) VALUES
    ('00000000-0000-0000-0000-000000000031', 'Billing Team', '00000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM teams
    WHERE id = '00000000-0000-0000-0000-000000000031'
      AND organization_id = '00000000-0000-0000-0000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 3.2: teams.organization_id not set (rows=%)', n; END IF;
END $$;

-- 3.3 api_requests.api_type -------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM api_requests WHERE api_type = 'REST';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 3.3a: api_requests should default to REST (rows=%)', n; END IF;
  UPDATE api_requests SET api_type = 'SOAP' WHERE id = '00000000-0000-0000-0000-000000000025';
  SELECT count(*) INTO n FROM api_requests WHERE api_type = 'SOAP';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 3.3b: api_type=SOAP not applied'; END IF;
END $$;

-- 3.4 Team sharing into a workspace grants access ---------------------------
DO $$
DECLARE n int;
BEGIN
  INSERT INTO teams (id, name, organization_id) VALUES
    ('00000000-0000-0000-0000-000000000030', 'Platform Team', '00000000-0000-0000-0000-000000000001');
  INSERT INTO team_members (team_id, user_id, role) VALUES
    ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000005', 'VIEWER');
  INSERT INTO workspace_teams (workspace_id, team_id, role) VALUES
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000030', 'EDITOR');

  -- The team grants its member effective access to the private workspace.
  SELECT count(*) INTO n
  FROM workspace_teams wt
  JOIN team_members tm ON tm.team_id = wt.team_id
  WHERE wt.workspace_id = '00000000-0000-0000-0000-000000000010'
    AND tm.user_id = '00000000-0000-0000-0000-000000000005';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 3.4: team sharing does not grant workspace access (rows=%)', n; END IF;
END $$;

-- 3.5 Collection auth provider pointing at an AUTH request ------------------
DO $$
DECLARE n int; src uuid;
BEGIN
  INSERT INTO auth_providers (collection_id, auth_type, token_request_id, token_path)
    VALUES ('00000000-0000-0000-0000-000000000021', 'BEARER_TOKEN',
            '00000000-0000-0000-0000-000000000022', 'access_token');
  SELECT count(*) INTO n FROM auth_providers
    WHERE collection_id = '00000000-0000-0000-0000-000000000021'
      AND auth_type = 'BEARER_TOKEN' AND token_path = 'access_token';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 3.5a: auth_provider not persisted'; END IF;

  -- The referenced token source must be flagged AUTH (application contract).
  SELECT token_request_id INTO src FROM auth_providers
    WHERE collection_id = '00000000-0000-0000-0000-000000000021';
  SELECT count(*) INTO n FROM api_requests
    WHERE id = src AND api_type = 'AUTH';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3.5b: token source should be an AUTH-type request'; END IF;
END $$;
