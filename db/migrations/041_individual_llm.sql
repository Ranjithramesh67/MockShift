-- ============================================================================
-- API Hub — 041_individual_llm.sql
-- Individual "bring your own LLM" configuration, gated by a platform-admin
-- global toggle.
--
--   portal_settings.allow_individual_llm (default FALSE) is the master switch.
--     false -> the per-user config UI is hidden and the copilot uses the
--              server USER_LLM_* environment variables only.
--     true  -> a user may store THEIR OWN OpenAI-compatible config, and the
--              copilot prefers it over the environment.
--
--   user_llm_configs stores exactly one config per user. The API key is
--   encrypted at rest with pgp_sym_encrypt(value, app.vault_key()); the key is
--   never returned to clients and never written to ai_copilot_usage.
-- ============================================================================

ALTER TABLE portal_settings
  ADD COLUMN allow_individual_llm boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN portal_settings.allow_individual_llm IS
  'Master switch for per-user LLM configuration. Default FALSE: individuals cannot bring their own key and the copilot uses USER_LLM_* only.';

CREATE TABLE user_llm_configs (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key_encrypted bytea NOT NULL,
  base_url          text NOT NULL,
  model             text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_llm_configs IS
  'One OpenAI-compatible LLM config per user. api_key_encrypted is pgp_sym_encrypt(apiKey, app.vault_key()); the key is never returned to clients.';

-- Defense in depth: a user may only read/write their own row. The app connects
-- as a privileged role today, so the real authorization is in the route.
ALTER TABLE user_llm_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_llm_configs_select ON user_llm_configs FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY user_llm_configs_insert ON user_llm_configs FOR INSERT
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY user_llm_configs_update ON user_llm_configs FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY user_llm_configs_delete ON user_llm_configs FOR DELETE
  USING (user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_llm_configs TO app_user;
