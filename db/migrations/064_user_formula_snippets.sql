-- Mockshift — 064_user_formula_snippets.sql
--
-- Per-user custom formula snippets.
--
-- Users can create named formula snippets in the helper panel. They are stored
-- server-side (not localStorage) so they follow the account to every device.
-- `NULL` or an empty array means "no custom snippets".
--
-- Values are objects with title + code (and optional description). They are
-- validated in the API before write, but the CHECK keeps a non-array value
-- from ever being stored.
--
-- Append-only: do not edit earlier migrations.

ALTER TABLE users ADD COLUMN IF NOT EXISTS formula_snippets jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_formula_snippets_is_array'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_formula_snippets_is_array
      CHECK (formula_snippets IS NULL OR jsonb_typeof(formula_snippets) = 'array');
  END IF;
END$$;

COMMENT ON COLUMN users.formula_snippets IS
  'User-created formula helper snippets (JSON array of {title, code, description}); NULL = none.';
