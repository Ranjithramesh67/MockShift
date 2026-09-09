-- ============================================================================
-- API Hub — 028_docs_share_audiences.sql
-- Targeted doc sharing (Docs round 3, DR1): a page can be shared with
-- specific users, with a team, with a whole organization, or kept as a public
-- link.
--
-- doc_shares becomes a per-target grant table (one row per grant):
--   kind='public' -> secret token link. Anonymous viewers get a sanitized,
--                    read-only snapshot and only when holding the token; there
--                    is no listing/recent discovery (O2). At most one per page.
--   kind='user'   -> read grant for target_user_id (any platform user).
--   kind='team'   -> read grant for every member of team_id. The team must
--                    belong to the doc's owning organization (route check).
--   kind='org'    -> read grant for every member of target_org_id. Only the
--                    doc's owning organization is targetable (route check).
--
-- All targeted audiences are read-only at the route layer: editing still
-- requires the page author or a workspace role >= EDITOR. Only 'public'
-- shares go through the plan-gated public-sharing gate.
--
-- RLS note: the application connects as a privileged role that bypasses RLS;
-- enforcement lives in the route handlers. When a dedicated app role is
-- introduced, doc_shares SELECT/INSERT policies must additionally honor
-- share-target audiences (user/team/org rows) and doc_pages must expose rows
-- reachable through doc_shares to their share targets.
-- ============================================================================

ALTER TABLE doc_shares
  ALTER COLUMN token DROP NOT NULL,
  ADD COLUMN kind           text NOT NULL DEFAULT 'public',
  ADD COLUMN target_user_id uuid REFERENCES users(id)         ON DELETE CASCADE,
  ADD COLUMN team_id        uuid REFERENCES teams(id)         ON DELETE CASCADE,
  ADD COLUMN target_org_id  uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- -------------------------------------------------------------- Constraints
-- The token is required exactly for public shares (NULL for targeted rows).
ALTER TABLE doc_shares
  ADD CONSTRAINT doc_shares_token_kind_check
    CHECK ((kind = 'public') = (token IS NOT NULL));

-- The audience kind determines which target column is set; they never mix.
ALTER TABLE doc_shares
  ADD CONSTRAINT doc_shares_kind_target_check
    CHECK (
      CASE kind
        WHEN 'user'   THEN target_user_id IS NOT NULL AND team_id IS NULL        AND target_org_id IS NULL
        WHEN 'team'   THEN team_id IS NOT NULL        AND target_user_id IS NULL AND target_org_id IS NULL
        WHEN 'org'    THEN target_org_id IS NOT NULL  AND target_user_id IS NULL AND team_id IS NULL
        WHEN 'public' THEN target_user_id IS NULL     AND team_id IS NULL        AND target_org_id IS NULL
        ELSE false
      END
    );

-- At most one public link and at most one grant per user/team/org per page.
CREATE UNIQUE INDEX doc_shares_public_one_per_page
  ON doc_shares (doc_id) WHERE kind = 'public';
CREATE UNIQUE INDEX doc_shares_user_one_per_page
  ON doc_shares (doc_id, target_user_id) WHERE kind = 'user';
CREATE UNIQUE INDEX doc_shares_team_one_per_page
  ON doc_shares (doc_id, team_id) WHERE kind = 'team';
CREATE UNIQUE INDEX doc_shares_org_one_per_page
  ON doc_shares (doc_id, target_org_id) WHERE kind = 'org';

-- ------------------------------------------------------------ Descriptions
COMMENT ON TABLE doc_shares IS
  'Per-target read grants for a doc page: an optional secret public token link (kind=public) and/or targeted audiences (kind=user/team/org).';
COMMENT ON COLUMN doc_shares.kind IS
  'Grant audience: public (secret token link), user (target_user_id), team (team_id) or org (target_org_id).';
COMMENT ON COLUMN doc_shares.token IS
  'Opaque uuid secret for kind=public share links (/s/doc/<token>); NULL for targeted audiences.';
COMMENT ON COLUMN doc_shares.target_user_id IS
  'User granted read access when kind=user (SET NULL cascade when the user is deleted).';
COMMENT ON COLUMN doc_shares.team_id IS
  'Team whose members are granted read access when kind=team; must belong to the owning organization.';
COMMENT ON COLUMN doc_shares.target_org_id IS
  'Organization whose members are granted read access when kind=org; must be the owning organization.';
