-- ============================================================================
-- TEST 15 — 015_portal_audit_promo.sql contract (Portal B):
--   * audit_log   — immutable trail; SELECT only for ADMIN/MANAGER/SUPPORT,
--                   INSERT allowed for ADMIN/MANAGER/SUPPORT/VIEWER, and there
--                   is deliberately NO UPDATE/DELETE policy (rows are inert).
--   * promo_codes — SELECT for ADMIN/MANAGER/SUPPORT/VIEWER; INSERT+UPDATE for
--                   ADMIN/MANAGER; DELETE for ADMIN only.
--   * Unique/CHECK/NOT NULL/FK-CASCADE constraints + invoices.number unique.
--
-- Fixtures (see db/seed.sql; global users.role defaults to EDITOR):
--   user 000...002 admin    -> MANAGER (this file, last suite: safe to mutate)
--   user 000...003 editor   -> ADMIN
--   user 000...004 outsider -> SUPPORT
--   user 000...005 insider  -> VIEWER
--   plans is seeded by migration 013 (free/starter/...); a dedicated plan
--   row is added below for promo-code FK/CASCADE coverage.
-- ============================================================================
\set ON_ERROR_STOP on
\echo '== TEST 15: Portal B — audit_log & promo_codes RLS (migration 015) =='

-- ----------------------------------------------------------------------------
-- 15.1 Schema sanity: tables, columns, constraints, RLS enabled
-- ----------------------------------------------------------------------------
\echo '-- 15.1 Schema sanity (audit_log / promo_codes / invoices) --'

DO $$
DECLARE n int;
BEGIN
  -- audit_log: presence + documented columns.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_log'
  ) THEN RAISE EXCEPTION 'FAIL 15.1: audit_log table missing'; END IF;

  SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_log'
      AND column_name IN ('id','actor_user_id','actor_name','actor_role','action',
                          'target_type','target_id','target_ref','before','after',
                          'ip_address','created_at');
  IF n <> 12 THEN
    RAISE EXCEPTION 'FAIL 15.1: audit_log missing documented columns (found %)', n;
  END IF;

  -- Documented NOT NULL audit_log columns must really be NOT NULL.
  SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_log'
      AND column_name IN ('actor_user_id','actor_name','actor_role',
                          'action','target_type')
      AND is_nullable = 'YES';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 15.1: audit_log NOT NULL columns are nullable (%)', n;
  END IF;

  -- actor_user_id FK -> users(id) ON DELETE RESTRICT.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t  ON t.oid  = c.conrelid
    JOIN pg_class rt ON rt.oid = c.confrelid
    WHERE t.relname = 'audit_log' AND rt.relname = 'users'
      AND c.contype = 'f' AND c.confdeltype = 'r'
      AND EXISTS (SELECT 1 FROM unnest(c.conkey) a WHERE a = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = t.oid AND attname = 'actor_user_id'))
  ) THEN RAISE EXCEPTION 'FAIL 15.1: audit_log.actor_user_id FK->users (RESTRICT) missing'; END IF;

  -- promo_codes: presence + documented columns.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'promo_codes'
  ) THEN RAISE EXCEPTION 'FAIL 15.1: promo_codes table missing'; END IF;

  SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promo_codes'
      AND column_name IN ('id','code','description','discount_type','discount_value',
                          'currency','plan_id','max_uses','used_count','active',
                          'starts_at','expires_at','created_at','updated_at');
  IF n <> 14 THEN
    RAISE EXCEPTION 'FAIL 15.1: promo_codes missing documented columns (found %)', n;
  END IF;

  -- Documented NOT NULL promo_codes columns must really be NOT NULL.
  SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promo_codes'
      AND column_name IN ('code','discount_type','discount_value','currency',
                          'used_count','active','created_at','updated_at')
      AND is_nullable = 'YES';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 15.1: promo_codes NOT NULL columns are nullable (%)', n;
  END IF;

  -- promo_codes.code is UNIQUE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'promo_codes' AND c.contype = 'u'
      AND EXISTS (SELECT 1 FROM unnest(c.conkey) a WHERE a = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = t.oid AND attname = 'code'))
  ) THEN RAISE EXCEPTION 'FAIL 15.1: promo_codes.code uniqueness not enforced'; END IF;

  -- promo_codes.discount_type carries the PERCENT/FIXED CHECK.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'promo_codes' AND c.contype = 'c'
      AND EXISTS (SELECT 1 FROM unnest(c.conkey) a WHERE a = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = t.oid AND attname = 'discount_type'))
  ) THEN RAISE EXCEPTION 'FAIL 15.1: promo_codes.discount_type CHECK missing'; END IF;

  -- promo_codes.plan_id FK -> plans(id) ON DELETE CASCADE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t  ON t.oid  = c.conrelid
    JOIN pg_class rt ON rt.oid = c.confrelid
    WHERE t.relname = 'promo_codes' AND rt.relname = 'plans'
      AND c.contype = 'f' AND c.confdeltype = 'c'
      AND EXISTS (SELECT 1 FROM unnest(c.conkey) a WHERE a = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = t.oid AND attname = 'plan_id'))
  ) THEN RAISE EXCEPTION 'FAIL 15.1: promo_codes.plan_id FK->plans (CASCADE) missing'; END IF;

  -- invoices.number is UNIQUE (migration 013 contract referenced by 015).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'invoices' AND c.contype = 'u'
      AND EXISTS (SELECT 1 FROM unnest(c.conkey) a WHERE a = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = t.oid AND attname = 'number'))
  ) THEN RAISE EXCEPTION 'FAIL 15.1: invoices.number uniqueness not enforced'; END IF;

  RAISE NOTICE 'PASS 15.1: audit_log + promo_codes tables, columns and constraints present';
END $$;

-- RLS is ENABLED on both portal tables.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_class
    WHERE oid IN ('audit_log'::regclass, 'promo_codes'::regclass)
      AND relrowsecurity = true;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL 15.1: RLS not enabled on audit_log/promo_codes (enabled=%)', n;
  END IF;
  RAISE NOTICE 'PASS 15.1: row-level security ENABLED on audit_log and promo_codes';
END $$;

-- ----------------------------------------------------------------------------
-- 15.2 Fixture setup (as postgres, before any SET ROLE): pin the four seed
-- users to their final portal roles once, then add a dedicated plan row.
-- ----------------------------------------------------------------------------
\echo '-- 15.2 Fixture setup: portal roles + test plan --'

UPDATE users SET role = 'MANAGER'::role WHERE email = 'admin@example.com';
UPDATE users SET role = 'ADMIN'::role   WHERE email = 'editor@example.com';
UPDATE users SET role = 'SUPPORT'::role WHERE email = 'outsider@example.com';
UPDATE users SET role = 'VIEWER'::role  WHERE email = 'insider@example.com';

INSERT INTO plans (id, key, name, status)
VALUES ('00000000-0000-0000-0000-000000000099', 'ptest', 'P Test', 'PUBLISHED');

DO $$
DECLARE n int; r role;
BEGIN
  SELECT count(*) INTO n FROM users
    WHERE (email, role) IN (('admin@example.com','MANAGER'::role),
                            ('editor@example.com','ADMIN'::role),
                            ('outsider@example.com','SUPPORT'::role),
                            ('insider@example.com','VIEWER'::role));
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 15.2: portal roles not assigned (rows=%)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE key = 'ptest' AND status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'FAIL 15.2: test plan ptest not created';
  END IF;
  SELECT role INTO r FROM users WHERE email = 'editor@example.com';
  IF r <> 'ADMIN'::role THEN RAISE EXCEPTION 'FAIL 15.2: editor role is %', r; END IF;
  RAISE NOTICE 'PASS 15.2: roles ADMIN/MANAGER/SUPPORT/VIEWER assigned; plan ptest created';
END $$;

-- ----------------------------------------------------------------------------
-- 15.3 promo_codes RLS by portal role
-- ----------------------------------------------------------------------------
\echo '-- 15.3 promo_codes RLS --'

-- 15.3.1 ADMIN (editor@example.com) may INSERT, SELECT and UPDATE a promo code.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE n int; descr text;
BEGIN
  IF app.portal_role() <> 'ADMIN'::role THEN
    RAISE EXCEPTION 'FAIL 15.3.1: portal_role is not ADMIN';
  END IF;
  INSERT INTO promo_codes (code, description, discount_type, discount_value, currency, plan_id)
  VALUES ('ADMIN50', '50 percent off launch', 'PERCENT', 50.00, 'INR',
          '00000000-0000-0000-0000-000000000099');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.3.1: ADMIN INSERT affected % row(s)', n; END IF;

  SELECT count(*) INTO n FROM promo_codes WHERE code = 'ADMIN50';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.3.1: ADMIN cannot SELECT own promo code (rows=%)', n; END IF;

  UPDATE promo_codes SET description = '50 percent off launch (updated)' WHERE code = 'ADMIN50';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.3.1: ADMIN UPDATE affected % row(s)', n; END IF;

  SELECT description INTO descr FROM promo_codes WHERE code = 'ADMIN50';
  IF descr <> '50 percent off launch (updated)' THEN
    RAISE EXCEPTION 'FAIL 15.3.1: ADMIN UPDATE not persisted (%)', descr;
  END IF;
  RAISE NOTICE 'PASS 15.3.1: ADMIN inserted, selected and updated a promo code';
END $$;
RESET ROLE;
COMMIT;

-- 15.3.2 MANAGER (admin@example.com) may INSERT and UPDATE (but not DELETE).
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE n int; descr text;
BEGIN
  IF app.portal_role() <> 'MANAGER'::role THEN
    RAISE EXCEPTION 'FAIL 15.3.2: portal_role is not MANAGER';
  END IF;
  INSERT INTO promo_codes (code, description, discount_type, discount_value, currency)
  VALUES ('MGR20', 'fixed 200 off', 'FIXED', 200.00, 'INR');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.3.2: MANAGER INSERT affected % row(s)', n; END IF;

  SELECT count(*) INTO n FROM promo_codes WHERE code = 'MGR20';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.3.2: MANAGER cannot SELECT own promo code (rows=%)', n; END IF;

  UPDATE promo_codes SET description = 'fixed 200 off (updated)' WHERE code = 'MGR20';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.3.2: MANAGER UPDATE affected % row(s)', n; END IF;

  SELECT description INTO descr FROM promo_codes WHERE code = 'MGR20';
  IF descr <> 'fixed 200 off (updated)' THEN
    RAISE EXCEPTION 'FAIL 15.3.2: MANAGER UPDATE not persisted (%)', descr;
  END IF;

  -- DELETE is ADMIN-only: MANAGER DELETE on ADMIN's row must touch 0 rows.
  DELETE FROM promo_codes WHERE code = 'ADMIN50';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.3.2: MANAGER DELETE removed % row(s)', n; END IF;
  RAISE NOTICE 'PASS 15.3.2: MANAGER inserted/updated promo code; DELETE correctly denied';
END $$;
RESET ROLE;
COMMIT;

-- 15.3.3 SUPPORT (outsider@example.com) may SELECT but not INSERT/UPDATE/DELETE.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE n int;
BEGIN
  IF app.portal_role() <> 'SUPPORT'::role THEN
    RAISE EXCEPTION 'FAIL 15.3.3: portal_role is not SUPPORT';
  END IF;
  SELECT count(*) INTO n FROM promo_codes WHERE code IN ('ADMIN50', 'MGR20');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 15.3.3: SUPPORT cannot SELECT promo codes (rows=%)', n; END IF;

  BEGIN
    INSERT INTO promo_codes (code, discount_value)
    VALUES ('SUPPORTX', 10.00);
    RAISE EXCEPTION 'FAIL 15.3.3: SUPPORT INSERT succeeded on promo_codes';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%row-level security%' THEN
      RAISE EXCEPTION 'FAIL 15.3.3: SUPPORT INSERT failed for wrong reason: %', SQLERRM;
    END IF;
  END;

  UPDATE promo_codes SET description = 'mutated by support' WHERE code = 'ADMIN50';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.3.3: SUPPORT UPDATE touched % row(s)', n; END IF;

  DELETE FROM promo_codes WHERE code = 'ADMIN50';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.3.3: SUPPORT DELETE removed % row(s)', n; END IF;
  RAISE NOTICE 'PASS 15.3.3: SUPPORT SELECT ok; INSERT rejected by RLS; UPDATE/DELETE 0 rows';
END $$;
RESET ROLE;
COMMIT;

-- 15.3.4 VIEWER (insider@example.com) may list but may not mutate.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000005', true);
DO $$
DECLARE n int;
BEGIN
  IF app.portal_role() <> 'VIEWER'::role THEN
    RAISE EXCEPTION 'FAIL 15.3.4: portal_role is not VIEWER';
  END IF;
  SELECT count(*) INTO n FROM promo_codes WHERE code IN ('ADMIN50', 'MGR20');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 15.3.4: VIEWER cannot SELECT promo codes (rows=%)', n; END IF;

  BEGIN
    INSERT INTO promo_codes (code, discount_value)
    VALUES ('VIEWERX', 10.00);
    RAISE EXCEPTION 'FAIL 15.3.4: VIEWER INSERT succeeded on promo_codes';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%row-level security%' THEN
      RAISE EXCEPTION 'FAIL 15.3.4: VIEWER INSERT failed for wrong reason: %', SQLERRM;
    END IF;
  END;

  UPDATE promo_codes SET description = 'mutated by viewer' WHERE code = 'ADMIN50';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.3.4: VIEWER UPDATE touched % row(s)', n; END IF;

  DELETE FROM promo_codes WHERE code = 'ADMIN50';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.3.4: VIEWER DELETE removed % row(s)', n; END IF;
  RAISE NOTICE 'PASS 15.3.4: VIEWER SELECT ok; INSERT rejected by RLS; UPDATE/DELETE 0 rows';
END $$;
RESET ROLE;
COMMIT;

-- 15.3.5 ADMIN DELETE positive: ADMIN (editor) may delete both live codes.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE n int;
BEGIN
  DELETE FROM promo_codes WHERE code IN ('ADMIN50', 'MGR20');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 15.3.5: ADMIN DELETE removed % row(s), expected 2', n; END IF;
  SELECT count(*) INTO n FROM promo_codes;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.3.5: promo_codes not empty after ADMIN delete (rows=%)', n; END IF;
  RAISE NOTICE 'PASS 15.3.5: ADMIN deleted the promo codes (2 rows); table clean';
END $$;
RESET ROLE;
COMMIT;

-- ----------------------------------------------------------------------------
-- 15.4 audit_log RLS: insert for all four portal roles, select visibility,
--     and no UPDATE/DELETE path for anyone.
-- ----------------------------------------------------------------------------
\echo '-- 15.4 audit_log RLS --'

-- 15.4.1a ADMIN may insert an audit row.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE n int;
BEGIN
  INSERT INTO audit_log (actor_user_id, actor_name, actor_role, action, target_type, target_ref, after)
  VALUES ('00000000-0000-0000-0000-000000000003', 'Workspace Editor', 'ADMIN',
          'promo_codes.delete', 'promo_code', 'ADMIN50',
          '{"ok":true}'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.4.1: ADMIN audit insert affected % row(s)', n; END IF;
  RAISE NOTICE 'PASS 15.4.1: ADMIN inserted an audit_log row';
END $$;
RESET ROLE;
COMMIT;

-- 15.4.1b MANAGER may insert an audit row.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  INSERT INTO audit_log (actor_user_id, actor_name, actor_role, action, target_type, target_ref, after)
  VALUES ('00000000-0000-0000-0000-000000000002', 'Org Admin', 'MANAGER',
          'promo_codes.insert', 'promo_code', 'MGR20',
          '{"discount":"200 INR"}'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.4.1: MANAGER audit insert affected % row(s)', n; END IF;
  RAISE NOTICE 'PASS 15.4.1: MANAGER inserted an audit_log row';
END $$;
RESET ROLE;
COMMIT;

-- 15.4.1c SUPPORT may insert an audit row.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE n int;
BEGIN
  INSERT INTO audit_log (actor_user_id, actor_name, actor_role, action, target_type, target_ref)
  VALUES ('00000000-0000-0000-0000-000000000004', 'Viewer (no workspace)', 'SUPPORT',
          'plans.view', 'plan', 'ptest');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.4.1: SUPPORT audit insert affected % row(s)', n; END IF;
  RAISE NOTICE 'PASS 15.4.1: SUPPORT inserted an audit_log row';
END $$;
RESET ROLE;
COMMIT;

-- 15.4.1d VIEWER may insert an audit row (policy grants INSERT to VIEWER even
-- though VIEWER can never SELECT from audit_log).
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000005', true);
DO $$
DECLARE n int;
BEGIN
  INSERT INTO audit_log (actor_user_id, actor_name, actor_role, action, target_type, target_ref)
  VALUES ('00000000-0000-0000-0000-000000000005', 'Viewer (workspace member)', 'VIEWER',
          'subscriptions.view', 'subscription', 'sub-2026-01');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 15.4.1: VIEWER audit insert affected % row(s)', n; END IF;
  RAISE NOTICE 'PASS 15.4.1: VIEWER inserted an audit_log row (INSERT policy allows it)';
END $$;
RESET ROLE;
COMMIT;

-- 15.4.2a ADMIN sees all four audit rows.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM audit_log;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 15.4.2: ADMIN sees % audit rows, expected 4', n; END IF;
  RAISE NOTICE 'PASS 15.4.2: ADMIN reads all 4 audit_log rows';
END $$;
RESET ROLE;
COMMIT;

-- 15.4.2b SUPPORT sees all four audit rows.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM audit_log;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 15.4.2: SUPPORT sees % audit rows, expected 4', n; END IF;
  RAISE NOTICE 'PASS 15.4.2: SUPPORT reads all 4 audit_log rows';
END $$;
RESET ROLE;
COMMIT;

-- 15.4.2c VIEWER sees nothing (SELECT policy excludes VIEWER).
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000005', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM audit_log;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.4.2: VIEWER sees % audit rows, expected 0', n; END IF;
  RAISE NOTICE 'PASS 15.4.2: VIEWER SELECT returns 0 audit_log rows';
END $$;
RESET ROLE;
COMMIT;

-- 15.4.3 audit_log is immutable: no UPDATE/DELETE policy exists, so even ADMIN
--       (who can SELECT the rows) gets 0 rows affected.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE n int;
BEGIN
  UPDATE audit_log SET actor_name = 'tampered' WHERE action IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.4.3: ADMIN UPDATE changed % audit row(s)', n; END IF;

  DELETE FROM audit_log WHERE actor_role = 'VIEWER';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15.4.3: ADMIN DELETE removed % audit row(s)', n; END IF;

  -- Rows must still be intact for ADMIN.
  SELECT count(*) INTO n FROM audit_log;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 15.4.3: audit_log count changed after UPDATE/DELETE (%)', n; END IF;
  RAISE NOTICE 'PASS 15.4.3: ADMIN UPDATE/DELETE on audit_log affected 0 rows (immutable)';
END $$;
RESET ROLE;
COMMIT;

-- ----------------------------------------------------------------------------
-- 15.5 Superuser constraint checks (duplicate/CHECK/NOT NULL/cascade).
-- ----------------------------------------------------------------------------
\echo '-- 15.5 Constraint enforcement --'

-- 15.5.1 duplicate promo_codes.code raises unique_violation.
DO $$
BEGIN
  INSERT INTO promo_codes (code, discount_value) VALUES ('DUPCHK', 10.00);
  BEGIN
    INSERT INTO promo_codes (code, discount_value) VALUES ('DUPCHK', 20.00);
    RAISE EXCEPTION 'FAIL 15.5.1: duplicate promo code accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  DELETE FROM promo_codes WHERE code = 'DUPCHK';
  RAISE NOTICE 'PASS 15.5.1: duplicate promo_codes.code rejected (unique)';
END $$;

-- 15.5.2 unknown discount_type raises a CHECK violation.
DO $$
BEGIN
  BEGIN
    INSERT INTO promo_codes (code, discount_type, discount_value) VALUES ('BOGUS', 'BOGUS', 5.00);
    RAISE EXCEPTION 'FAIL 15.5.2: discount_type BOGUS accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 15.5.2: discount_type BOGUS rejected (CHECK)';
END $$;

-- 15.5.3 NULL discount_value raises a NOT NULL violation.
DO $$
BEGIN
  BEGIN
    INSERT INTO promo_codes (code, discount_value) VALUES ('NULLVAL', NULL);
    RAISE EXCEPTION 'FAIL 15.5.3: NULL discount_value accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 15.5.3: NULL discount_value rejected (NOT NULL)';
END $$;

-- 15.5.4 invoices.number is unique (requires an order -> invoice pair).
DO $$
DECLARE order_id uuid;
BEGIN
  INSERT INTO orders (id, user_id, plan_id, amount)
  VALUES ('00000000-0000-0000-0000-000000000090',
          '00000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000099', 100.00)
  RETURNING id INTO order_id;

  INSERT INTO invoices (id, order_id, user_id, number, amount)
  VALUES ('00000000-0000-0000-0000-000000000091', order_id,
          '00000000-0000-0000-0000-000000000002', 'INV-TEST-0001', 100.00);

  BEGIN
    INSERT INTO invoices (id, order_id, user_id, number, amount)
    VALUES ('00000000-0000-0000-0000-000000000092', order_id,
            '00000000-0000-0000-0000-000000000002', 'INV-TEST-0001', 100.00);
    RAISE EXCEPTION 'FAIL 15.5.4: duplicate invoices.number accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 15.5.4: duplicate invoices.number rejected (unique)';
END $$;

-- 15.5.5 deleting a plan cascades to its promo codes (FK ON DELETE CASCADE).
DO $$
BEGIN
  INSERT INTO plans (id, key, name, status)
  VALUES ('00000000-0000-0000-0000-000000000098', 'pdel', 'P Delete', 'PUBLISHED');
  INSERT INTO promo_codes (code, discount_value, plan_id)
  VALUES ('CASCADEME', 25.00, '00000000-0000-0000-0000-000000000098');

  DELETE FROM plans WHERE id = '00000000-0000-0000-0000-000000000098';

  IF EXISTS (SELECT 1 FROM promo_codes WHERE code = 'CASCADEME') THEN
    RAISE EXCEPTION 'FAIL 15.5.5: promo code survived plan deletion (cascade broken)';
  END IF;
  RAISE NOTICE 'PASS 15.5.5: plan delete cascades to referencing promo_codes row';
END $$;
