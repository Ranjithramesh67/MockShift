-- Seed data for tests. Idempotent: wipes the app tables first.
-- Vault key used for encrypting secrets in this seed (tests reuse it).

SELECT set_config('app.vault_key', 'test-vault-key-do-not-use-in-prod', false);

TRUNCATE test_results, run_history, workflow_chains, variables, environments,
         api_requests, collections, projects, workspace_members, workspaces,
         organization_members, organizations, team_members, teams, users
  RESTART IDENTITY CASCADE;

-- Users ---------------------------------------------------------------------
INSERT INTO users (id, email, password_hash, name) VALUES
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com',  'x', 'Org Admin'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com', 'x', 'Workspace Editor'),
  ('00000000-0000-0000-0000-000000000004', 'outsider@example.com','x', 'Viewer (no workspace)'),
  ('00000000-0000-0000-0000-000000000005', 'insider@example.com', 'x', 'Viewer (workspace member)');

-- Organization ---------------------------------------------------------------
INSERT INTO organizations (id, name, owner_id) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Acme Corp', '00000000-0000-0000-0000-000000000002');

INSERT INTO organization_members (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'ADMIN'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'EDITOR'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'VIEWER'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'VIEWER');

-- Workspaces ---------------------------------------------------------------
-- PRIVATE: viewer_outsider is NOT a member. VIEWER insider IS a member.
INSERT INTO workspaces (id, organization_id, name, visibility) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Payments',    'PRIVATE'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Public Store','PUBLIC');

INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002', 'ADMIN'),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', 'EDITOR'),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000005', 'VIEWER'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', 'ADMIN'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000003', 'EDITOR');

-- Projects / collections / requests ----------------------------------------
INSERT INTO projects (id, workspace_id, name) VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000011', 'Store API');

INSERT INTO collections (id, project_id, name) VALUES
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000020', 'Orders');

INSERT INTO api_requests (id, collection_id, name, method, url) VALUES
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000021', 'Create Order', 'POST', '/orders'),
  ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000021', 'Get Order',    'GET',  '/orders/:id');

-- Environments --------------------------------------------------------------
INSERT INTO environments (id, workspace_id, name, is_active) VALUES
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000010', 'Payments Prod', true),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000011', 'Store Staging', true);

-- Variables -----------------------------------------------------------------
-- GLOBAL (personal vars, owned by admin) ------------------------
INSERT INTO variables (key, scope, is_secret, value_encrypted, value_plain, created_by) VALUES
  ('ORDER_ID', 'GLOBAL', true, pgp_sym_encrypt('GLOBAL-0', current_setting('app.vault_key')), NULL,
   '00000000-0000-0000-0000-000000000002'),
  ('REGION', 'GLOBAL', false, NULL, 'global-region',
   '00000000-0000-0000-0000-000000000002'),
  ('THEME', 'GLOBAL', false, NULL, 'dark',
   '00000000-0000-0000-0000-000000000002');

-- WORKSPACE (public workspace "Store") ---------------------------
INSERT INTO variables (key, scope, is_secret, value_encrypted, value_plain, workspace_id) VALUES
  ('ORDER_ID', 'WORKSPACE', true, pgp_sym_encrypt('WS-1', current_setting('app.vault_key')), NULL,
   '00000000-0000-0000-0000-000000000011'),
  ('BASE_URL', 'WORKSPACE', false, NULL, 'https://store.example.com',
   '00000000-0000-0000-0000-000000000011'),
  ('AUTH_MODE', 'WORKSPACE', false, NULL, 'bearer',
   '00000000-0000-0000-0000-000000000011'),
  ('REGION', 'WORKSPACE', false, NULL, 'ws-region',
   '00000000-0000-0000-0000-000000000011');

-- WORKSPACE (private workspace "Payments") ------------------------
INSERT INTO variables (key, scope, is_secret, value_encrypted, value_plain, workspace_id) VALUES
  ('DB_PASSWORD', 'WORKSPACE', true, pgp_sym_encrypt('p@ssw0rd', current_setting('app.vault_key')), NULL,
   '00000000-0000-0000-0000-000000000010');

-- ENVIRONMENT (Store Staging) ------------------------------------
INSERT INTO variables (key, scope, is_secret, value_encrypted, value_plain, environment_id) VALUES
  ('ORDER_ID', 'ENVIRONMENT', true, pgp_sym_encrypt('ENV-1', current_setting('app.vault_key')), NULL,
   '00000000-0000-0000-0000-000000000024'),
  ('BASE_URL', 'ENVIRONMENT', false, NULL, 'https://staging.store.example.com',
   '00000000-0000-0000-0000-000000000024');

-- REQUEST (Create Order) -----------------------------------------
INSERT INTO variables (key, scope, is_secret, value_encrypted, value_plain, request_id) VALUES
  ('ORDER_ID', 'REQUEST', true, pgp_sym_encrypt('REQ-1', current_setting('app.vault_key')), NULL,
   '00000000-0000-0000-0000-000000000022');
