-- ============================================================================
-- API Hub — 029_docs_visibility_tree.sql
-- Docs round 3 (DR3 + DR4 groundwork): per-doc visibility and a Confluence
-- style document tree.
--
--   doc_pages.visibility  'PRIVATE' (default) | 'PUBLIC'. A PUBLIC page is
--     readable by any member of the owning organization (in addition to the
--     existing workspace/project readers, share audiences and platform
--     MANAGER/ADMIN). Anonymous access is unchanged: share-link only.
--   doc_pages.parent_id   self-referencing FK (ON DELETE CASCADE) so deleting
--     a page removes its whole sub-tree, matching tree semantics. A child page
--     must live in the same workspace as its parent (route layer).
--
-- Read inheritance for targeted share audiences is resolved in the route
-- layer: sharing a page grants its whole sub-tree (audiences climb the parent
-- chain / walk children through doc_shares).
--
-- RLS note: enforcement stays in the route handlers (privileged app role);
-- future app-role policies on doc_pages must account for PUBLIC pages and
-- parent-chain visibility.
-- ============================================================================

ALTER TABLE doc_pages
  ADD COLUMN visibility text NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN parent_id   uuid REFERENCES doc_pages(id) ON DELETE CASCADE;

ALTER TABLE doc_pages
  ADD CONSTRAINT doc_pages_visibility_check
    CHECK (visibility IN ('PRIVATE', 'PUBLIC'));

CREATE INDEX doc_pages_parent_idx ON doc_pages (parent_id);

COMMENT ON COLUMN doc_pages.visibility IS
  'PRIVATE (default) — only workspace readers/share audiences/org admins; PUBLIC — readable by every member of the owning organization.';
COMMENT ON COLUMN doc_pages.parent_id IS
  'Parent page in the same workspace (NULL = root). Deleting a page cascades to its sub-tree.';
