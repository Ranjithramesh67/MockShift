-- ============================================================================
-- TEST 1 — RBAC: a 'VIEWER' cannot mutate an Environment Variable in a
-- Private Workspace they do not belong to. Enforcement is via PostgreSQL RLS
-- (db/migrations/001_init.sql), not application code, so a compromised ORM
-- query cannot bypass it.
--
-- Fixtures (see db/seed.sql):
--   user 000...004 viewer_outsider  — org member, NOT a workspace member
--   user 000...005 viewer_insider   — org member, VIEWER member of Payments
--   user 000...003 editor           — EDITOR member of Payments
--   ws    000...010 Payments        — PRIVATE workspace
--   var   key=DB_PASSWORD, scope=WORKSPACE in Payments (secret)
-- ============================================================================
\set ON_ERROR_STOP on
\echo '== TEST 1: Viewer cannot mutate variables in a private workspace =='

-- 1.1 Viewer outsider cannot even READ the private workspace variable.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM variables v
  WHERE v.workspace_id = '00000000-0000-0000-0000-000000000010'
    AND v.scope = 'WORKSPACE' AND v.key = 'DB_PASSWORD';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 1.1: viewer outsider can read a variable in a private workspace (rows=%)', n;
  END IF;
  RAISE NOTICE 'PASS 1.1: viewer outsider sees 0 rows (private workspace invisible under RLS)';
END $$;
RESET ROLE;
COMMIT;

-- 1.2 Viewer outsider UPDATE attempt -> 0 rows affected (silently filtered).
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
SELECT set_config('app.vault_key', 'test-vault-key-do-not-use-in-prod', true);
DO $$
DECLARE n int;
BEGIN
  UPDATE variables v
  SET value_encrypted = pgp_sym_encrypt('MUTATED', current_setting('app.vault_key'))
  WHERE v.workspace_id = '00000000-0000-0000-0000-000000000010'
    AND v.scope = 'WORKSPACE' AND v.key = 'DB_PASSWORD';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 1.2: viewer outsider UPDATE mutated % row(s)', n;
  END IF;
  RAISE NOTICE 'PASS 1.2: viewer outsider UPDATE affected 0 rows (RLS filtered)';
END $$;
RESET ROLE;
COMMIT;

-- 1.3 Viewer outsider DELETE attempt -> 0 rows affected.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE n int;
BEGIN
  DELETE FROM variables v
  WHERE v.workspace_id = '00000000-0000-0000-0000-000000000010'
    AND v.scope = 'WORKSPACE' AND v.key = 'DB_PASSWORD';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 1.3: viewer outsider DELETE removed % row(s)', n;
  END IF;
  RAISE NOTICE 'PASS 1.3: viewer outsider DELETE affected 0 rows (RLS filtered)';
END $$;
RESET ROLE;
COMMIT;

-- 1.4 Viewer outsider INSERT attempt -> hard rejection (policy WITH CHECK).
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
SELECT set_config('app.vault_key', 'test-vault-key-do-not-use-in-prod', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO variables (key, scope, is_secret, value_encrypted, workspace_id)
    VALUES ('PWNED', 'WORKSPACE', true,
            pgp_sym_encrypt('x', current_setting('app.vault_key')),
            '00000000-0000-0000-0000-000000000010');
    RAISE EXCEPTION 'FAIL 1.4: viewer outsider INSERT succeeded into private workspace';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 1.4: viewer outsider INSERT rejected by RLS (permission denied)';
  END;
END $$;
RESET ROLE;
COMMIT;

-- 1.5 Control: even a Viewer who IS a workspace member cannot mutate (role gate).
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000005', true);
SELECT set_config('app.vault_key', 'test-vault-key-do-not-use-in-prod', true);
DO $$
DECLARE n int;
BEGIN
  UPDATE variables v
  SET value_encrypted = pgp_sym_encrypt('MUTATED', current_setting('app.vault_key'))
  WHERE v.workspace_id = '00000000-0000-0000-0000-000000000010'
    AND v.scope = 'WORKSPACE' AND v.key = 'DB_PASSWORD';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 1.5: viewer (workspace member) UPDATE mutated % row(s)', n;
  END IF;
  RAISE NOTICE 'PASS 1.5: viewer-insider UPDATE affected 0 rows (role gate holds)';
END $$;
RESET ROLE;
COMMIT;

-- 1.6 Control: an EDITOR member CAN mutate and the value round-trips decrypt.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', true);
SELECT set_config('app.vault_key', 'test-vault-key-do-not-use-in-prod', true);
DO $$
DECLARE n int; decrypted text;
BEGIN
  UPDATE variables v
  SET value_encrypted = pgp_sym_encrypt('EDITED-BY-EDITOR', current_setting('app.vault_key'))
  WHERE v.workspace_id = '00000000-0000-0000-0000-000000000010'
    AND v.scope = 'WORKSPACE' AND v.key = 'DB_PASSWORD';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 1.6: editor UPDATE affected % row(s), expected 1', n;
  END IF;
  SELECT pgp_sym_decrypt(value_encrypted, current_setting('app.vault_key'))
  INTO decrypted
  FROM variables
  WHERE workspace_id = '00000000-0000-0000-0000-000000000010'
    AND scope = 'WORKSPACE' AND key = 'DB_PASSWORD';
  IF decrypted <> 'EDITED-BY-EDITOR' THEN
    RAISE EXCEPTION 'FAIL 1.6: decrypted value mismatch (%)', decrypted;
  END IF;
  RAISE NOTICE 'PASS 1.6: editor mutated 1 row; value round-tripped through AES/pgp';
END $$;
RESET ROLE;
COMMIT;

-- 1.7 Restoration + verify no corruption from the blocked attempts.
UPDATE variables v
SET value_encrypted = pgp_sym_encrypt('p@ssw0rd', 'test-vault-key-do-not-use-in-prod')
WHERE v.workspace_id = '00000000-0000-0000-0000-000000000010'
  AND v.scope = 'WORKSPACE' AND v.key = 'DB_PASSWORD';

SELECT CASE
  WHEN pgp_sym_decrypt(value_encrypted, 'test-vault-key-do-not-use-in-prod') = 'p@ssw0rd'
    THEN 'PASS 1.7: secret intact after all blocked mutation attempts'
    ELSE 'FAIL 1.7: secret corrupted'
  END AS result
FROM variables
WHERE workspace_id = '00000000-0000-0000-0000-000000000010'
  AND scope = 'WORKSPACE' AND key = 'DB_PASSWORD';
