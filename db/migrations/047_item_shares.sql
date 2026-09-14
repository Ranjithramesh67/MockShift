-- 047_item_shares.sql
-- Login-gated read-only share links for any shareable item
-- (request / folder / collection / project / workspace).
--
-- A share is an unguessable uuid token that exposes a redacted, read-only
-- snapshot of the item to any *authenticated* user holding the link. Viewing a
-- share never requires a paid plan, and recipients do not need to share an
-- organization or workspace with the owner.
--
-- This generalises request_shares (009) to every item type; existing request
-- links are backfilled below so previously issued URLs keep working. The old
-- table is intentionally left in place (the read path falls back to it) and is
-- no longer written to.

CREATE TABLE item_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type  text NOT NULL,
  item_id    uuid NOT NULL,
  token      uuid NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_shares_type_check
    CHECK (item_type IN ('request', 'folder', 'collection', 'project', 'workspace')),
  UNIQUE (item_type, item_id)
);

CREATE INDEX item_shares_token_idx ON item_shares (token);

COMMENT ON TABLE item_shares IS
  'Login-gated read-only share links for requests, folders, collections, projects and workspaces.';
COMMENT ON COLUMN item_shares.item_type IS
  'Shareable item kind: request, folder, collection, project or workspace.';
COMMENT ON COLUMN item_shares.token IS
  'Opaque uuid secret used by /s/<token>; requires an authenticated viewer.';

GRANT SELECT, INSERT, UPDATE, DELETE ON item_shares TO app_user;

-- Backfill request links issued before this migration.
INSERT INTO item_shares (item_type, item_id, token, created_by, created_at)
SELECT 'request', request_id, token, created_by, created_at
  FROM request_shares
ON CONFLICT (item_type, item_id) DO NOTHING;
