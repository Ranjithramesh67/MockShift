-- Mockshift — 065_formula_shares.sql
--
-- Public snapshot links for custom formula snippets.
--
-- Sharing a formula copies title+code into this table under an unguessable
-- token. The snapshot is independent of later edits on the owner's account,
-- so a link always imports the formula as it was when shared. Anyone holding
-- the token can read it (no login); importing onto another account requires
-- a session.
--
-- Append-only: do not edit earlier migrations.

CREATE TABLE IF NOT EXISTS formula_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token      uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  snippet    jsonb NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'formula_shares_snippet_is_object'
  ) THEN
    ALTER TABLE formula_shares ADD CONSTRAINT formula_shares_snippet_is_object
      CHECK (jsonb_typeof(snippet) = 'object');
  END IF;
END$$;

COMMENT ON TABLE formula_shares IS
  'Public snapshot of a custom formula (title+code) behind an unguessable token.';
