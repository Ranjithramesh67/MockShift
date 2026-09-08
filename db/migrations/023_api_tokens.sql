-- ============================================================================
-- API Hub — 023_api_tokens.sql
-- Personal API tokens (roadmap S4): machine authentication for the main API.
--
-- A token is a random secret returned in PLAINTEXT exactly once at creation.
-- The DB stores only a SHA-256 hex digest (`token_hash`) so a leaked copy of
-- the table never yields usable credentials. `prefix` (e.g. the first 12 chars
-- of the token) is shown in the UI so owners can tell tokens apart.
--
-- Scopes are a coarse allow-list: read / write / runs. Enforcement happens in
-- the API route layer (backend/src/api/tokenAuth.js + route middleware); the
-- CHECK below only guarantees stored values are well-formed.
--
-- RLS mirrors the 013/016/020 owner-scoped pattern: an api_tokens row is only
-- visible to the user it belongs to. The app connects as a privileged role
-- today, so real authorization lives in the routes.
-- ============================================================================

CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,                 -- display-only leading chunk
  token_hash   text NOT NULL UNIQUE,          -- sha256 hex of the raw token
  scopes       text[] NOT NULL DEFAULT ARRAY['read']
               CHECK (scopes <@ ARRAY['read', 'write', 'runs']::text[]),
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'revoked')),
  last_used_at timestamptz,                   -- set on each successful bearer auth
  expires_at   timestamptz,                   -- NULL = never expires
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);
CREATE UNIQUE INDEX api_tokens_user_prefix_uidx ON api_tokens (user_id, prefix);

COMMENT ON TABLE api_tokens IS
  'Personal API tokens for machine auth. token_hash stores sha256(raw token); the raw token is returned once at creation and never stored or served again.';
COMMENT ON COLUMN api_tokens.prefix IS
  'Leading characters of the raw token (display-only, never secret alone).';
COMMENT ON COLUMN api_tokens.scopes IS
  'Allowed scopes, subset of {read, write, runs}. Runs require runs or write.';

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_tokens_select ON api_tokens FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY api_tokens_insert ON api_tokens FOR INSERT
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY api_tokens_update ON api_tokens FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY api_tokens_delete ON api_tokens FOR DELETE
  USING (user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON api_tokens TO app_user;
