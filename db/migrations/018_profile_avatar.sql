-- ============================================================================
-- API Hub — 018_profile_avatar.sql
-- PR-1 profile surface: avatar columns on users.
--
-- An avatar is either a predefined preset key (rendered from frontend bundled
-- assets — always available, no upload) or an uploaded image stored in the DB
-- (bytea + content type, cap ~2 MB enforced at the route). Setting one clears
-- the other. avatar_updated_at lets the UI cache-bust and shows last change.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN avatar_key        text,          -- predefined preset key, e.g. 'preset-1'
  ADD COLUMN avatar_data       bytea,         -- uploaded image bytes (NULL when preset-only)
  ADD COLUMN avatar_type       text,          -- image/png|jpeg|gif|webp (NULL when preset-only)
  ADD COLUMN avatar_updated_at timestamptz;   -- when the avatar last changed

COMMENT ON COLUMN users.avatar_key IS
  'Predefined avatar preset key rendered from bundled frontend assets. Mutually exclusive with avatar_data.';
COMMENT ON COLUMN users.avatar_data IS
  'Uploaded avatar image bytes (max ~2 MB, enforced by POST /api/profile/avatar). NULL when a preset key is in use.';
