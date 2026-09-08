-- ============================================================================
-- API Hub — 026_docs_image_share.sql
-- Docs extension (L1):
--
--  1. doc_blocks.block_type CHECK is widened to admit an 'image' block so a
--     page body can embed an inline image (http(s) URL or data:image data URL,
--     validated in the route layer like the other block types).
--  2. doc_shares — a public share link for a doc page. Holding a token grants
--     anonymous read access to a sanitized snapshot of the page (no ids,
--     emails or request internals). One share row per page (token is a uuid);
--     the page/snapshot tables are untouched.
--
-- RLS note: mirrors 025 — the application connects as a privileged role today
-- (bypasses RLS). Policies mirror the doc_blocks pattern for a future
-- dedicated app role: a share is only visible/mutable to people who can
-- read/mutate the owning page (which follows the workspace).
-- ============================================================================

-- ------------------------------------------------- Image blocks
ALTER TABLE doc_blocks DROP CONSTRAINT doc_blocks_type_check;

ALTER TABLE doc_blocks
  ADD CONSTRAINT doc_blocks_type_check CHECK (
    block_type IN ('heading', 'text', 'code', 'payload', 'response', 'schema', 'list', 'image')
  );

-- ------------------------------------------------------------------ Shares
CREATE TABLE doc_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id     uuid NOT NULL REFERENCES doc_pages(id) ON DELETE CASCADE,
  token      uuid NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX doc_shares_doc_idx ON doc_shares (doc_id);

-- ------------------------------------------------------------ Descriptions
COMMENT ON TABLE doc_shares IS
  'A public share link for a doc page. The token is the secret; holding it grants anonymous read access to a sanitized page snapshot.';
COMMENT ON COLUMN doc_shares.doc_id IS
  'The doc page being shared (cascade delete removes the share with the page).';
COMMENT ON COLUMN doc_shares.token IS
  'Opaque uuid secret embedded in the share URL (/s/doc/<token>); also used to look the snapshot up.';
COMMENT ON COLUMN doc_shares.created_by IS
  'User who created the share link (SET NULL when the user is deleted).';
COMMENT ON COLUMN doc_shares.created_at IS
  'When the share link was created.';

COMMENT ON COLUMN doc_blocks.block_type IS
  'One of heading, text, code, payload, response, schema, list or image; required content keys are validated in the route layer.';

-- ------------------------------------------------------------------ Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_shares TO app_user;

-- ------------------------------------------------------------- RLS policies
ALTER TABLE doc_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY doc_shares_select ON doc_shares FOR SELECT
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = doc_id AND app.workspace_readable(p.workspace_id)));
CREATE POLICY doc_shares_insert ON doc_shares FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM doc_pages p
                      WHERE p.id = doc_id AND app.can_mutate_workspace(p.workspace_id)));
CREATE POLICY doc_shares_update ON doc_shares FOR UPDATE
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = doc_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM doc_pages p
                      WHERE p.id = doc_id AND app.can_mutate_workspace(p.workspace_id)));
CREATE POLICY doc_shares_delete ON doc_shares FOR DELETE
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = doc_id AND app.can_mutate_workspace(p.workspace_id)));
