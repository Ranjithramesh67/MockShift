-- ============================================================================
-- API Hub — 022_send_item.sql
-- Send an item (request / folder / collection / project / workspace) to another
-- user. The recipient sees it as a pending "send" in their inbox and may ACCEPT
-- (a copy is cloned into their own account/workspace — the sender keeps the
-- original) or REJECT (the decision is recorded and the sender is notified).
--
-- Lifecycle (enforced in the sends router, mirrored here as cheap invariants):
--   pending  -> accepted | rejected   (responded_at set once, never back)
--   accepted_path holds where the accepted copy landed (recipient-scoped);
--   it is only filled on accept.
--
-- RLS note: the application connects as a privileged role today (bypasses
-- RLS). Policies mirror the 011/020 pattern for a future dedicated app role:
-- a user may only ever see / mutate sends where they are the sender or the
-- recipient, and may only create sends as themselves.
-- ============================================================================

CREATE TABLE sends (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type      text NOT NULL,
  item_id        uuid NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  message        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  responded_at   timestamptz,
  accepted_path  jsonb,
  CONSTRAINT sends_item_type_check CHECK (
    item_type IN ('request', 'folder', 'collection', 'project', 'workspace')
  ),
  CONSTRAINT sends_status_check CHECK (
    status IN ('pending', 'accepted', 'rejected')
  ),
  CONSTRAINT sends_responded_invariant CHECK (
    (status = 'pending' AND responded_at IS NULL) OR
    (status <> 'pending' AND responded_at IS NOT NULL)
  ),
  CONSTRAINT sends_accepted_path_invariant CHECK (
    status <> 'accepted' OR accepted_path IS NOT NULL
  )
);

COMMENT ON TABLE sends IS
  'Peer-to-peer item sends with an accept/reject inbox. Accept clones the source item into the recipient own account; the sender keeps the original.';
COMMENT ON COLUMN sends.item_type IS
  'Kind of the item being sent: request, folder, collection, project or workspace (item_id resolves inside the matching table).';
COMMENT ON COLUMN sends.accepted_path IS
  'Recipient-scoped location of the accepted copy: { type, name, workspaceId, workspaceName, projectId?, projectName?, collectionId?, collectionName?, folderId?, folderName? }.';

-- Inbox lookups: recipient pending/responded feeds, sender outbox.
CREATE INDEX sends_recipient_idx ON sends (recipient_id, status, created_at DESC);
CREATE INDEX sends_sender_idx    ON sends (sender_id, created_at DESC);

ALTER TABLE sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY sends_select ON sends FOR SELECT
  USING (sender_id = app.current_user_id() OR recipient_id = app.current_user_id());
CREATE POLICY sends_insert ON sends FOR INSERT
  WITH CHECK (sender_id = app.current_user_id());
CREATE POLICY sends_update ON sends FOR UPDATE
  USING (sender_id = app.current_user_id() OR recipient_id = app.current_user_id())
  WITH CHECK (true);
CREATE POLICY sends_delete ON sends FOR DELETE
  USING (sender_id = app.current_user_id() OR recipient_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON sends TO app_user;
