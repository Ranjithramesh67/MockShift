-- --------------------------------------------------------- Auth one-time tokens
-- Backs password reset and email verification. Only sha256(raw) is stored; the
-- raw secret lives only in the emailed link.
CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('password_reset', 'email_verification')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_kind_idx ON auth_tokens (user_id, kind);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);

-- Email verification state. Existing accounts are grandfathered as verified so
-- the migration cannot lock anyone out; accounts created after this migration
-- default to unverified (signup sets the flag explicitly via the column default).
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
UPDATE users SET email_verified = true;

-- Audit-only timestamp set when a password is reset/changed. Session
-- invalidation is enforced by users.session_epoch (see migration 045 and
-- requireAuth), not by this column. Null means "no password change on record".
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
