-- ============================================================================
-- API Hub — 025_docs.sql
-- Confluence-style "Docs" workspace feature:
--   doc_pages                  a documentation page living in a workspace,
--                              optionally bound to one of its projects.
--   doc_blocks                 the ordered rich-content body of a page.
--   doc_mentions               references to a user or an api_requests row
--                              placed on a page (uniq per (page, type, ref)).
--   workspace_access_requests  ask to join a workspace; a workspace admin
--                              approves (granting a VIEWER membership) or
--                              denies the request.
--
-- A page's blocks are a flat, position-ordered list (0..n-1). The API treats
-- the block list as replaceable wholesale (PUT /docs/:pageId/blocks), so no
-- tree/parent structure is stored. Positions are reassigned server-side.
--
-- Pending-uniqueness for workspace_access_requests (one open request per
-- user+workspace) cannot be a plain UNIQUE constraint because status rows are
-- permanent (PENDING -> APPROVED/DENIED/CANCELLED, so the same user/workspace
-- pair legitimately accumulates closed rows). It is therefore enforced with a
-- SELECT in the route layer before INSERT, mirroring the access_requests
-- pattern in the routes.
--
-- RLS note: the application connects as a privileged role today (bypasses
-- RLS). Policies mirror the 022 sends / 011 folders pattern for a future
-- dedicated app role: docs are only visible/mutable to people who can
-- read/mutate the owning workspace.
-- ============================================================================

-- ------------------------------------------------- Workspace membership audit
-- Record who granted (or last updated) a workspace membership so the
-- workspace-access-request review can attribute the grant.
ALTER TABLE workspace_members
  ADD COLUMN granted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------ Pages
CREATE TABLE doc_pages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES projects(id) ON DELETE SET NULL,
  title        text NOT NULL,
  created_by   uuid NOT NULL REFERENCES users(id),
  updated_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX doc_pages_workspace_idx ON doc_pages (workspace_id, updated_at DESC);
CREATE INDEX doc_pages_project_idx   ON doc_pages (project_id);
CREATE INDEX doc_pages_created_idx   ON doc_pages (created_by);

-- ---------------------------------------------------------------- Blocks
-- A page body is a flat, ordered list of typed content blocks. block_type and
-- the required content keys are validated in the route layer; the CHECK below
-- only pins the allowed block vocabulary.
CREATE TABLE doc_blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    uuid NOT NULL REFERENCES doc_pages(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  block_type text NOT NULL,
  content    jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (page_id, position),
  CONSTRAINT doc_blocks_type_check CHECK (
    block_type IN ('heading', 'text', 'code', 'payload', 'response', 'schema', 'list')
  )
);

CREATE INDEX doc_blocks_page_idx ON doc_blocks (page_id, position);

-- -------------------------------------------------------------- Mentions
-- A page can reference users (members of the page's workspace) and API
-- requests (living in a collection of the page's workspace).
CREATE TABLE doc_mentions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      uuid NOT NULL REFERENCES doc_pages(id) ON DELETE CASCADE,
  mention_type text NOT NULL,
  ref_id       uuid NOT NULL,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, mention_type, ref_id),
  CONSTRAINT doc_mentions_type_check CHECK (mention_type IN ('user', 'api'))
);

CREATE INDEX doc_mentions_ref_idx ON doc_mentions (mention_type, ref_id);

-- ------------------------------------------------- Workspace access requests
CREATE TABLE workspace_access_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       text,
  status       text NOT NULL DEFAULT 'PENDING',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  CONSTRAINT workspace_access_requests_status_check CHECK (
    status IN ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED')
  )
);

CREATE INDEX workspace_access_requests_workspace_idx
  ON workspace_access_requests (workspace_id, status, requested_at DESC);
CREATE INDEX workspace_access_requests_user_idx
  ON workspace_access_requests (user_id, status, requested_at DESC);

-- ------------------------------------------------------------ Descriptions
COMMENT ON TABLE doc_pages IS
  'A documentation page in a workspace, optionally bound to one of the workspace projects.';
COMMENT ON COLUMN doc_pages.project_id IS
  'Optional project the page is about; NULL for workspace-level pages.';
COMMENT ON COLUMN doc_pages.created_by IS
  'Author of the page; the author may always edit it regardless of later workspace role changes.';
COMMENT ON COLUMN doc_pages.updated_by IS
  'Last user who mutated the page (title, blocks or mentions); NULL until first edit.';

COMMENT ON TABLE doc_blocks IS
  'A page body block. Position is 0-based and reassigned on every wholesale block replace.';
COMMENT ON COLUMN doc_blocks.block_type IS
  'One of heading, text, code, payload, response, schema or list; required content keys are validated in the route layer.';
COMMENT ON COLUMN doc_blocks.content IS
  'Type-specific content jsonb, e.g. heading {text}, code {language, code}, list {style, items}.';

COMMENT ON TABLE doc_mentions IS
  'A reference on a page to a user (member of the page workspace) or an api_requests row (in a collection of the page workspace).';
COMMENT ON COLUMN doc_mentions.mention_type IS
  'user or api; ref_id resolves inside users / api_requests accordingly.';
COMMENT ON COLUMN doc_mentions.created_by IS
  'User who placed the mention on the page.';

COMMENT ON TABLE workspace_access_requests IS
  'A request to join a workspace. Lifecycle: PENDING -> APPROVED (grants VIEWER membership) | DENIED, or PENDING -> CANCELLED by the requester.';
COMMENT ON COLUMN workspace_access_requests.status IS
  'PENDING, APPROVED, DENIED or CANCELLED. One PENDING request per (workspace, user) is enforced with a SELECT in the route layer.';
COMMENT ON COLUMN workspace_access_requests.reviewed_by IS
  'Workspace admin (or platform manager/admin) who reviewed the request.';
COMMENT ON COLUMN workspace_members.granted_by IS
  'User who granted (or last updated) this workspace membership.';

-- ------------------------------------------------------------------ Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  doc_pages, doc_blocks, doc_mentions, workspace_access_requests
  TO app_user;

-- ------------------------------------------------------------- RLS policies
ALTER TABLE doc_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_access_requests ENABLE ROW LEVEL SECURITY;

-- Pages: visible/mutable exactly when the owning workspace is readable/mutable.
CREATE POLICY doc_pages_select ON doc_pages FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY doc_pages_insert ON doc_pages FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));
CREATE POLICY doc_pages_update ON doc_pages FOR UPDATE
  USING (app.can_mutate_workspace(workspace_id))
  WITH CHECK (app.can_mutate_workspace(workspace_id));
CREATE POLICY doc_pages_delete ON doc_pages FOR DELETE
  USING (app.can_mutate_workspace(workspace_id));

-- Blocks / mentions follow their page (which follows the workspace).
CREATE POLICY doc_blocks_select ON doc_blocks FOR SELECT
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = page_id AND app.workspace_readable(p.workspace_id)));
CREATE POLICY doc_blocks_insert ON doc_blocks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM doc_pages p
                      WHERE p.id = page_id AND app.can_mutate_workspace(p.workspace_id)));
CREATE POLICY doc_blocks_update ON doc_blocks FOR UPDATE
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = page_id AND app.can_mutate_workspace(p.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM doc_pages p
                      WHERE p.id = page_id AND app.can_mutate_workspace(p.workspace_id)));
CREATE POLICY doc_blocks_delete ON doc_blocks FOR DELETE
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = page_id AND app.can_mutate_workspace(p.workspace_id)));

CREATE POLICY doc_mentions_select ON doc_mentions FOR SELECT
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = page_id AND app.workspace_readable(p.workspace_id)));
CREATE POLICY doc_mentions_insert ON doc_mentions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM doc_pages p
                      WHERE p.id = page_id AND app.can_mutate_workspace(p.workspace_id)));
CREATE POLICY doc_mentions_delete ON doc_mentions FOR DELETE
  USING (EXISTS (SELECT 1 FROM doc_pages p
                 WHERE p.id = page_id AND app.can_mutate_workspace(p.workspace_id)));

-- Access requests: requesters see their own; workspace admins (direct role)
-- see and review the rows for the workspace. Real authorization lives in the
-- route layer (platform managers/admins are handled there too).
CREATE POLICY workspace_access_requests_select ON workspace_access_requests FOR SELECT
  USING (
    user_id = app.current_user_id()
    OR app.workspace_role(app.current_user_id(), workspace_id) = 'ADMIN'
  );
CREATE POLICY workspace_access_requests_insert ON workspace_access_requests FOR INSERT
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY workspace_access_requests_update ON workspace_access_requests FOR UPDATE
  USING (
    app.workspace_role(app.current_user_id(), workspace_id) = 'ADMIN'
    OR (user_id = app.current_user_id() AND status = 'PENDING')
  )
  WITH CHECK (
    app.workspace_role(app.current_user_id(), workspace_id) = 'ADMIN'
    OR user_id = app.current_user_id()
  );
