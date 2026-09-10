-- ============================================================================
-- API Hub — 036_collab_reviews.sql
-- Collaboration round (P5 / E5): comment threads, a lightweight collection
-- review flow, and version snapshots with diff.
--
--   collab_comments      threaded comments attached to an api_requests row or
--                        a collections row. target_id is polymorphic (no FK);
--                        the route layer resolves the owning project and
--                        validates the target exists. parent_id is a one-level
--                        self reference (a reply to a top-level thread root).
--   collection_reviews   a review request on a collection plus the reviewer's
--                        decision. The collection's *current* status is derived
--                        from the latest review row:
--                          none | pending | approved | changes_requested
--                        At most one pending review per collection (partial
--                        unique index).
--   collection_versions  explicit JSON snapshots of a collection and its
--                        requests (version_number is per-collection, 1-based).
--                        diffSnapshots() in collabDiff.js compares two of them.
--
-- Access model: routes gate on getProjectAccess (reads: any access; mutations:
-- EDITOR+). RLS mirrors the 025 docs pattern for a future dedicated app role:
-- rows are visible when the owning workspace is readable, writable when the
-- owning workspace is mutable.
-- ============================================================================

-- ------------------------------------------------------------------ Comments
CREATE TABLE collab_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  target_type  text NOT NULL,
  target_id    uuid NOT NULL,
  parent_id    uuid REFERENCES collab_comments(id) ON DELETE CASCADE,
  body         text NOT NULL,
  author_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resolved     boolean NOT NULL DEFAULT false,
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collab_comments_target_type_check CHECK (target_type IN ('request', 'collection'))
);

CREATE INDEX collab_comments_target_idx
  ON collab_comments (target_type, target_id, created_at);
CREATE INDEX collab_comments_parent_idx ON collab_comments (parent_id);
CREATE INDEX collab_comments_author_idx ON collab_comments (author_id);

-- ------------------------------------------------------------- Review flow
CREATE TABLE collection_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES workspaces(id)  ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id)    ON DELETE CASCADE,
  requested_by     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending',
  request_comment  text,
  decision_comment text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  CONSTRAINT collection_reviews_status_check CHECK (
    status IN ('pending', 'approved', 'changes_requested')
  )
);

CREATE INDEX collection_reviews_collection_idx
  ON collection_reviews (collection_id, created_at DESC);
CREATE INDEX collection_reviews_reviewer_idx ON collection_reviews (reviewer_id);

-- Only one open review per collection at a time.
CREATE UNIQUE INDEX collection_reviews_one_pending_idx
  ON collection_reviews (collection_id) WHERE status = 'pending';

-- -------------------------------------------------------------- Versions
CREATE TABLE collection_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id)  ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects(id)    ON DELETE CASCADE,
  version_number integer NOT NULL,
  label          text,
  snapshot       jsonb NOT NULL,
  created_by     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, version_number)
);

CREATE INDEX collection_versions_collection_idx
  ON collection_versions (collection_id, version_number DESC);

-- ------------------------------------------------------------ Descriptions
COMMENT ON TABLE collab_comments IS
  'Threaded comment on an api_requests (target_type=request) or collections (target_type=collection) row.';
COMMENT ON COLUMN collab_comments.parent_id IS
  'Reply target: a top-level thread root on the same target; NULL for a thread root.';
COMMENT ON COLUMN collab_comments.resolved IS
  'Thread resolution flag, stored on the thread root; replies inherit it when serialized.';

COMMENT ON TABLE collection_reviews IS
  'A lightweight review request on a collection and its decision. Current status = latest row (none when no rows).';
COMMENT ON COLUMN collection_reviews.status IS
  'pending until a reviewer decides: approved or changes_requested.';

COMMENT ON TABLE collection_versions IS
  'Explicit JSON snapshot of a collection and its requests; version_number is 1-based per collection.';
COMMENT ON COLUMN collection_versions.snapshot IS
  'Serialized { collection:{id,name,projectId}, requests:[...] } payload compared by collabDiff.diffSnapshots().';

-- ------------------------------------------------------------------ Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  collab_comments, collection_reviews, collection_versions
  TO app_user;

-- ------------------------------------------------------------- RLS policies
ALTER TABLE collab_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_reviews   ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_versions  ENABLE ROW LEVEL SECURITY;

-- Comments: any workspace reader may read/comment/resolve; fine-grained
-- mutation rules (author vs editor) live in the route layer.
CREATE POLICY collab_comments_select ON collab_comments FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY collab_comments_insert ON collab_comments FOR INSERT
  WITH CHECK (app.workspace_readable(workspace_id));
CREATE POLICY collab_comments_update ON collab_comments FOR UPDATE
  USING (app.workspace_readable(workspace_id))
  WITH CHECK (app.workspace_readable(workspace_id));
CREATE POLICY collab_comments_delete ON collab_comments FOR DELETE
  USING (app.workspace_readable(workspace_id));

-- Reviews: readable with the workspace, creatable/decidable by editors.
CREATE POLICY collection_reviews_select ON collection_reviews FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY collection_reviews_insert ON collection_reviews FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));
CREATE POLICY collection_reviews_update ON collection_reviews FOR UPDATE
  USING (app.workspace_readable(workspace_id))
  WITH CHECK (app.workspace_readable(workspace_id));

-- Versions: readable with the workspace, snapshots created by editors.
CREATE POLICY collection_versions_select ON collection_versions FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY collection_versions_insert ON collection_versions FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));
CREATE POLICY collection_versions_delete ON collection_versions FOR DELETE
  USING (app.can_mutate_workspace(workspace_id));
