-- ============================================================================
-- API Hub — 035_ai_copilot.sql
-- AI copilot (E4 / P4): audit trail for LLM-backed copilot capabilities.
--
-- The copilot itself (backend/src/api/llm.js + routes/copilot.js) is BYO-key:
-- it reads only the project-scoped USER_LLM_* environment variables. This table
-- records one row per attempted capability so usage is auditable and can be
-- quota/telemetry-consumed later. It deliberately stores no prompt, response
-- body or credential — only counters and a coarse status/error string.
--
-- capability is one of generate-assertions / explain-run / generate-docs.
-- provider/model are informational (never a key). workspace_id/project_id/
-- request_id/run_id are best-effort context and may be NULL.
--
-- RLS mirrors the 013/016/020/023 owner-scoped pattern: a usage row is only
-- visible to the user it belongs to. The app connects as a privileged role
-- today, so real authorization lives in the route layer.
-- ============================================================================

CREATE TABLE ai_copilot_usage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  workspace_id      uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
  capability        text NOT NULL
                    CHECK (capability IN ('generate-assertions', 'explain-run', 'generate-docs')),
  provider          text,
  model             text,
  request_id        uuid REFERENCES api_requests(id) ON DELETE SET NULL,
  run_id            uuid REFERENCES run_history(id) ON DELETE SET NULL,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  status            text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_copilot_usage_user_idx       ON ai_copilot_usage (user_id, created_at DESC);
CREATE INDEX ai_copilot_usage_capability_idx ON ai_copilot_usage (capability, created_at DESC);

COMMENT ON TABLE ai_copilot_usage IS
  'One audit row per AI copilot capability call. Stores no prompts, responses or credentials — only counters and a coarse status.';
COMMENT ON COLUMN ai_copilot_usage.capability IS
  'generate-assertions, explain-run or generate-docs.';
COMMENT ON COLUMN ai_copilot_usage.provider IS
  'Informational provider label (e.g. openai-compatible); never an API key.';
COMMENT ON COLUMN ai_copilot_usage.model IS
  'Model name requested (USER_LLM_MODEL); never a credential.';

ALTER TABLE ai_copilot_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_copilot_usage_select ON ai_copilot_usage FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY ai_copilot_usage_insert ON ai_copilot_usage FOR INSERT
  WITH CHECK (user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_copilot_usage TO app_user;
