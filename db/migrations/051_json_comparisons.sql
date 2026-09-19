-- 051_json_comparisons.sql
-- Named JSON compare snapshots owned by the current user.

CREATE TABLE json_comparisons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  left_text       text NOT NULL DEFAULT '',
  right_text      text NOT NULL DEFAULT '',
  key_mode        text NOT NULL DEFAULT 'alpha',
  key_direction   text NOT NULL DEFAULT 'asc',
  array_mode      text NOT NULL DEFAULT 'none',
  array_direction text NOT NULL DEFAULT 'asc',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT json_comparisons_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT json_comparisons_key_mode CHECK (key_mode IN ('alpha', 'alphanum', 'original')),
  CONSTRAINT json_comparisons_array_mode CHECK (array_mode IN ('none', 'alpha', 'alphanum', 'numeric', 'length', 'type', 'json')),
  CONSTRAINT json_comparisons_key_dir CHECK (key_direction IN ('asc', 'desc')),
  CONSTRAINT json_comparisons_array_dir CHECK (array_direction IN ('asc', 'desc'))
);

CREATE INDEX json_comparisons_user_idx ON json_comparisons (user_id, updated_at DESC);

COMMENT ON TABLE json_comparisons IS
  'User-owned named JSON compare snapshots (left/right payloads plus sort options).';

ALTER TABLE json_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY json_comparisons_select ON json_comparisons FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY json_comparisons_insert ON json_comparisons FOR INSERT
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY json_comparisons_update ON json_comparisons FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY json_comparisons_delete ON json_comparisons FOR DELETE
  USING (user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON json_comparisons TO app_user;
