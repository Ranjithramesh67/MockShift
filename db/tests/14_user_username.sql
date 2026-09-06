-- ============================================================================
-- TEST 14 — 014_user_username.sql contract:
--   * users.username is required, unique (case-insensitive), and formatted
-- ============================================================================
\set ON_ERROR_STOP on
\echo '== TEST 14: users.username (migration 014) =='

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'username'
  ) THEN RAISE EXCEPTION 'FAIL 14.1: users.username column missing'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE username IS NULL OR username = '') THEN
    RAISE EXCEPTION 'FAIL 14.2: every user must have a username';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@example.com' AND username = 'admin') THEN
    RAISE EXCEPTION 'FAIL 14.3: seed admin username missing';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO users (email, password_hash, name, username)
      VALUES ('dup@example.com', 'x', 'Dup', 'ADMIN');
    RAISE EXCEPTION 'FAIL 14.4: case-insensitive username uniqueness not enforced';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO users (email, password_hash, name, username)
      VALUES ('bad@example.com', 'x', 'Bad', 'ab');
    RAISE EXCEPTION 'FAIL 14.5: username format check not enforced';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;
