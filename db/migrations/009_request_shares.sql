-- 009_request_shares.sql
-- Public read-only share links for individual requests. A share is an
-- unguessable token (uuid) that exposes a snapshot of the request plus its
-- most recent run's response to anyone holding the link, with no login.

CREATE TABLE request_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES api_requests(id) ON DELETE CASCADE,
  token      uuid NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX request_shares_request_idx ON request_shares (request_id);
