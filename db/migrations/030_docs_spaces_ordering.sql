-- ============================================================================
-- API Hub — 030_docs_spaces_ordering.sql
-- Docs round 3 (DR4 remainder): team ("space") binding + sibling ordering.
--
--   doc_pages.team_id   optional Confluence-style "space" binding. A page can
--     belong to one team of its owning organization so the home can group the
--     tree per team. NULL = unbound (workspace-wide). A bound team must belong
--     to the doc's owning organization (route layer); deleting the team clears
--     the binding on its pages rather than deleting docs.
--   doc_pages.position  sibling order within (workspace, parent). Lower shows
--     first; ties fall back to title. New pages append to the end. Reordering
--     is a route-layer swap; the column is a plain integer so the UI can move
--     a page up/down without rewriting every sibling.
--
-- RLS note: enforcement stays in the route handlers (privileged app role).
-- ============================================================================

ALTER TABLE doc_pages
  ADD COLUMN team_id  uuid REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN position integer NOT NULL DEFAULT 0;

CREATE INDEX doc_pages_sibling_order_idx
  ON doc_pages (workspace_id, parent_id, position);
CREATE INDEX doc_pages_team_idx ON doc_pages (team_id);

COMMENT ON COLUMN doc_pages.team_id IS
  'Optional team ("space") binding within the owning organization; NULL = workspace-wide.';
COMMENT ON COLUMN doc_pages.position IS
  'Sibling order within (workspace_id, parent_id); lower first, ties break by title.';
