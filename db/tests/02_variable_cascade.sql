-- ============================================================================
-- TEST 2 — Variable cascade: REQUEST > ENVIRONMENT > WORKSPACE > GLOBAL.
-- Uses app.resolve_variables(request_id, environment_id) and asserts priority
-- resolution plus RLS scoping (private-workspace secrets never surface here).
--
-- Fixtures (db/seed.sql), all in PUBLIC workspace 000...011 (Store):
--   key ORDER_ID : GLOBAL=GLOBAL-0, WS=WS-1, ENV=ENV-1, REQ(req22)=REQ-1
--   key BASE_URL : WS=https://store.example.com, ENV=https://staging...
--   key AUTH_MODE: WS=bearer
--   key REGION   : GLOBAL=global-region, WS=ws-region
--   key THEME    : GLOBAL=dark  (global-only fallback)
-- Requests: 000...022 "Create Order" (has REQUEST-level ORDER_ID),
--           000...025 "Get Order"    (no request-level variables).
-- ============================================================================
\set ON_ERROR_STOP on
\echo '== TEST 2: Environment variable cascade (workspace vs request level) =='

BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
SELECT set_config('app.vault_key', 'test-vault-key-do-not-use-in-prod', true);

-- 2.1 Request-level overrides environment / workspace / global.
DO $$
DECLARE v text; s text;
BEGIN
  SELECT value, source INTO v, s FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'ORDER_ID';
  IF v <> 'REQ-1' OR s <> 'REQUEST' THEN
    RAISE EXCEPTION 'FAIL 2.1: ORDER_ID resolved to % (%) expected REQ-1 (REQUEST)', v, s;
  END IF;
  RAISE NOTICE 'PASS 2.1: request-level ORDER_ID=% wins over all lower scopes', v;
END $$;

-- 2.2 Environment-level overrides workspace / global.
DO $$
DECLARE v text; s text;
BEGIN
  SELECT value, source INTO v, s FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'BASE_URL';
  IF v <> 'https://staging.store.example.com' OR s <> 'ENVIRONMENT' THEN
    RAISE EXCEPTION 'FAIL 2.2: BASE_URL resolved to % (%) expected ENVIRONMENT', v, s;
  END IF;
  RAISE NOTICE 'PASS 2.2: environment-level BASE_URL=% shadows workspace', v;
END $$;

-- 2.3 Workspace-level overrides global.
DO $$
DECLARE v text; s text;
BEGIN
  SELECT value, source INTO v, s FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'REGION';
  IF v <> 'ws-region' OR s <> 'WORKSPACE' THEN
    RAISE EXCEPTION 'FAIL 2.3: REGION resolved to % (%) expected ws-region (WORKSPACE)', v, s;
  END IF;
  RAISE NOTICE 'PASS 2.3: workspace-level REGION=% shadows global', v;
END $$;

-- 2.4 Global-only key still resolves (lowest priority fallback).
DO $$
DECLARE v text; s text;
BEGIN
  SELECT value, source INTO v, s FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'THEME';
  IF v <> 'dark' OR s <> 'GLOBAL' THEN
    RAISE EXCEPTION 'FAIL 2.4: THEME resolved to % (%) expected dark (GLOBAL)', v, s;
  END IF;
  RAISE NOTICE 'PASS 2.4: global-only THEME=% falls back to GLOBAL', v;
END $$;

-- 2.5 A request with NO request-level vars inherits environment then workspace.
DO $$
DECLARE o text; b text;
BEGIN
  SELECT value INTO o FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000025',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'ORDER_ID';
  IF o <> 'ENV-1' THEN
    RAISE EXCEPTION 'FAIL 2.5: request w/o override resolved ORDER_ID=% expected ENV-1', o;
  END IF;
  SELECT value INTO b FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000025',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'BASE_URL';
  IF b <> 'https://staging.store.example.com' THEN
    RAISE EXCEPTION 'FAIL 2.5: request w/o override resolved BASE_URL=%', b;
  END IF;
  RAISE NOTICE 'PASS 2.5: no request override -> ORDER_ID=% (ENV), BASE_URL=% (ENV)', o, b;
END $$;

-- 2.6 Private-workspace secret never leaks into a public-workspace resolution.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'DB_PASSWORD';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 2.6: private secret DB_PASSWORD leaked into public resolution';
  END IF;
  RAISE NOTICE 'PASS 2.6: private-workspace DB_PASSWORD absent from public resolution';
END $$;

RESET ROLE;
COMMIT;

-- 2.7 RLS proof: viewer outsider (PUBLIC-ws reader) can resolve PUBLIC
--     variables but never the PRIVATE workspace secret.
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE leaked int; base text;
BEGIN
  SELECT count(*) INTO leaked FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'DB_PASSWORD';
  IF leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL 2.7: private secret DB_PASSWORD visible to viewer outsider';
  END IF;
  SELECT value INTO base FROM app.resolve_variables(
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000024')
  WHERE key = 'BASE_URL';
  IF base IS DISTINCT FROM 'https://staging.store.example.com' THEN
    RAISE EXCEPTION 'FAIL 2.7: public BASE_URL not visible to outsider (%)', base;
  END IF;
  RAISE NOTICE 'PASS 2.7: outsider resolves public vars (BASE_URL=%) but never private secrets', base;
END $$;
RESET ROLE;
COMMIT;
