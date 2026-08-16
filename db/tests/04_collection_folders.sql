-- ============================================================================
-- TEST 4 — 011_folders.sql contract:
--   * folders exists with collection_id + self-referential parent_id
--   * folders nest arbitrarily deep (parent_id chain)
--   * api_requests.folder_id links a request into a folder (NULL = root)
--   * deleting a folder cascades its descendants
--   * deleting a folder SET NULLs its requests back to the collection root
--   * RLS mirrors the collections contract (workspace_readable / can_mutate)
--
-- Fixtures (see db/seed.sql):
--   collection 000...021 "Orders" under project 000...020 "Store API"
--     (workspace 000...011 "Public Store", PUBLIC visibility)
--   requests   000...022, 000...025 in collection 000...021
--   user       000...002 admin   — ADMIN  member of Public Store
--   user       000...003 editor  — EDITOR member of Public Store
--   user       000...004 outsider— org member, NO workspace access
-- ============================================================================
\set ON_ERROR_STOP on
\echo '== TEST 4: nested collection folders (migration 011) =='

-- 4.1 Schema: table + columns + self-reference --------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'folders' AND column_name = 'id'
  ) THEN RAISE EXCEPTION 'FAIL 4.1a: folders.id missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'folders' AND column_name = 'parent_id'
  ) THEN RAISE EXCEPTION 'FAIL 4.1b: folders.parent_id missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_requests' AND column_name = 'folder_id'
  ) THEN RAISE EXCEPTION 'FAIL 4.1c: api_requests.folder_id missing'; END IF;
  RAISE NOTICE 'PASS 4.1: folders schema present';
END $$;

-- 4.2 Admin creates a nested folder tree --------------------------------------
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  INSERT INTO folders (id, collection_id, name) VALUES
    ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000021', 'Customer');
  INSERT INTO folders (id, collection_id, parent_id, name) VALUES
    ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000021',
     '00000000-0000-0000-0000-000000000040', 'V2');
  INSERT INTO folders (id, collection_id, parent_id, name) VALUES
    ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000021',
     '00000000-0000-0000-0000-000000000041', 'Deep');
  SELECT count(*) INTO n FROM folders
    WHERE collection_id = '00000000-0000-0000-0000-000000000021';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 4.2a: expected 3 folders, got %', n; END IF;
  SELECT count(*) INTO n FROM folders
    WHERE parent_id = '00000000-0000-0000-0000-000000000040';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4.2b: expected 1 child under Customer, got %', n; END IF;
  SELECT count(*) INTO n FROM folders
    WHERE parent_id = '00000000-0000-0000-0000-000000000042';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4.2c: Deep should have no children yet'; END IF;
  RAISE NOTICE 'PASS 4.2: admin created root -> V2 -> Deep nesting';
END $$;
RESET ROLE;
COMMIT;

-- 4.3 Place requests into folders; deletion SET NULLs them --------------------
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  UPDATE api_requests SET folder_id = '00000000-0000-0000-0000-000000000041'
    WHERE id IN ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000025');
  SELECT count(*) INTO n FROM api_requests
    WHERE folder_id = '00000000-0000-0000-0000-000000000041';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 4.3a: expected 2 requests in V2, got %', n; END IF;

  DELETE FROM folders WHERE id = '00000000-0000-0000-0000-000000000041';
  SELECT count(*) INTO n FROM api_requests
    WHERE folder_id = '00000000-0000-0000-0000-000000000041';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4.3b: deleted folder should not reference requests'; END IF;
  SELECT count(*) INTO n FROM api_requests
    WHERE folder_id IS NULL AND collection_id = '00000000-0000-0000-0000-000000000021';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 4.3c: requests should fall back to collection root (folder_id NULL), got %', n; END IF;
  RAISE NOTICE 'PASS 4.3: deleting a folder SET NULLs its requests back to the root';
END $$;
RESET ROLE;
COMMIT;

-- 4.4 Deleting a folder cascades its descendants ------------------------------
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  DELETE FROM folders WHERE id = '00000000-0000-0000-0000-000000000040';
  SELECT count(*) INTO n FROM folders
    WHERE collection_id = '00000000-0000-0000-0000-000000000021';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4.4: deleting parent should cascade to all descendants, got %', n; END IF;
  RAISE NOTICE 'PASS 4.4: folder delete cascades to descendants';
END $$;
RESET ROLE;
COMMIT;

-- 4.5 RLS: viewer outsider cannot INSERT a folder -----------------------------
-- (Public Store is PUBLIC, so reads are allowed; writes require ADMIN/EDITOR.)
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  INSERT INTO folders (id, collection_id, name) VALUES
    ('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000021', 'Sneaky');
  RAISE EXCEPTION 'FAIL 4.5: viewer outsider INSERT into folder succeeded';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'PASS 4.5: viewer outsider folder INSERT rejected by RLS';
END $$;
RESET ROLE;
COMMIT;

-- 4.6 Deleting a collection cascades its folders ------------------------------
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  INSERT INTO folders (id, collection_id, name) VALUES
    ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000021', 'Temp');
  DELETE FROM collections WHERE id = '00000000-0000-0000-0000-000000000021';
  SELECT count(*) INTO n FROM folders
    WHERE collection_id = '00000000-0000-0000-0000-000000000021';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4.6: collection delete should cascade folders, got %', n; END IF;
  RAISE NOTICE 'PASS 4.6: collection delete cascades folders';
END $$;
RESET ROLE;
COMMIT;

-- 4.7 RLS: viewer outsider cannot read folders in a private workspace ---------
-- (Payments workspace 000...010 is PRIVATE and holds no collections in the
--  seed, so create a private project + collection + folder first.)
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  INSERT INTO projects (id, workspace_id, name) VALUES
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000010', 'Private Proj');
  INSERT INTO collections (id, project_id, name) VALUES
    ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000050', 'Hidden Coll');
  INSERT INTO folders (id, collection_id, name) VALUES
    ('00000000-0000-0000-0000-000000000045', '00000000-0000-0000-0000-000000000051', 'Hidden Folder');
END $$;
RESET ROLE;
COMMIT;

BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM folders
    WHERE id = '00000000-0000-0000-0000-000000000045';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4.7: viewer outsider can read private workspace folder'; END IF;
  RAISE NOTICE 'PASS 4.7: viewer outsider sees 0 private folders under RLS';
END $$;
RESET ROLE;
COMMIT;

-- 4.8 Control: an EDITOR member can create + mutate folders -------------------
BEGIN;
SET ROLE app_user;
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE n int;
BEGIN
  INSERT INTO folders (id, collection_id, name) VALUES
    ('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000051', 'Editor Folder');
  UPDATE folders SET name = 'Renamed by Editor'
    WHERE id = '00000000-0000-0000-0000-000000000044';
  SELECT count(*) INTO n FROM folders
    WHERE id = '00000000-0000-0000-0000-000000000044' AND name = 'Renamed by Editor';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4.8: editor could not rename folder'; END IF;
  RAISE NOTICE 'PASS 4.8: editor can create + rename folders in private workspace';
END $$;
RESET ROLE;
COMMIT;
