-- ============================================================================
-- API Hub — 052_company_networks.sql
-- Organization networks: an admin-maintained registry of company domains,
-- individual-to-individual invitations (friend requests), and the resulting
-- contact list.
--
--   company_domains — admin registers "Keera Innovations" + keerainnovations.com.
--                     Any account whose email uses a registered domain is
--                     treated as an organization member and auto-joins the
--                     linked COMPANY organization (see companyNetwork.js).
--   invitations     — a PENDING email invitation from one user to another.
--                     Organizations are exempt: teammates already share an
--                     organization and never need an invitation.
--   user_contacts   — a symmetric, accepted connection between two users.
--
-- Additive only; no existing rows are touched.
-- ============================================================================

-- ---------------------------------------------------------- Company domains
CREATE TABLE company_domains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    text NOT NULL,
  domain          text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_domains_domain_uniq UNIQUE (domain),
  CONSTRAINT company_domains_domain_lower CHECK (domain = lower(domain)),
  CONSTRAINT company_domains_domain_shape CHECK (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  CONSTRAINT company_domains_name_len CHECK (char_length(company_name) BETWEEN 1 AND 160)
);

CREATE INDEX company_domains_org_idx ON company_domains (organization_id);

COMMENT ON TABLE company_domains IS
  'Admin-maintained registry mapping a company name to the email domain(s) whose accounts belong to that company organization.';

-- -------------------------------------------------------------- Invitations
CREATE TABLE invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_email   text NOT NULL,
  invitee_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  kind            text NOT NULL DEFAULT 'FRIEND',
  status          text NOT NULL DEFAULT 'PENDING',
  message         text,
  token           text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  CONSTRAINT invitations_kind CHECK (kind IN ('FRIEND', 'ORG')),
  CONSTRAINT invitations_status CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  CONSTRAINT invitations_email_lower CHECK (invitee_email = lower(invitee_email)),
  CONSTRAINT invitations_not_self CHECK (invitee_id IS NULL OR invitee_id <> inviter_id),
  CONSTRAINT invitations_message_len CHECK (message IS NULL OR char_length(message) <= 500)
);

-- At most one outstanding invitation per (inviter, email) pair.
CREATE UNIQUE INDEX invitations_pending_uniq
  ON invitations (inviter_id, invitee_email)
  WHERE status = 'PENDING';

CREATE INDEX invitations_invitee_email_idx ON invitations (invitee_email, status, created_at DESC);
CREATE INDEX invitations_invitee_id_idx    ON invitations (invitee_id, status, created_at DESC);
CREATE INDEX invitations_inviter_idx       ON invitations (inviter_id, status, created_at DESC);

COMMENT ON TABLE invitations IS
  'Email invitations between users (friend requests). PENDING rows are unique per inviter+email.';

-- ---------------------------------------------------------------- Contacts
CREATE TABLE user_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_contacts_uniq UNIQUE (owner_id, contact_id),
  CONSTRAINT user_contacts_not_self CHECK (owner_id <> contact_id)
);

CREATE INDEX user_contacts_contact_idx ON user_contacts (contact_id);

COMMENT ON TABLE user_contacts IS
  'Accepted connections. Stored symmetrically: an accepted invite inserts both (owner, contact) directions.';

-- ------------------------------------------------------------ Access + RLS
ALTER TABLE company_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contacts   ENABLE ROW LEVEL SECURITY;

-- The registry is read during signup/login (before an app user context exists)
-- and is not sensitive: account classification depends on it. Writes only ever
-- originate from the admin-gated route in routes/admin.js, so RLS allows them
-- for any app connection while the route enforces the ADMIN check.
CREATE POLICY company_domains_select ON company_domains FOR SELECT
  USING (true);
CREATE POLICY company_domains_insert ON company_domains FOR INSERT
  WITH CHECK (true);
CREATE POLICY company_domains_update ON company_domains FOR UPDATE
  USING (true)
  WITH CHECK (true);
CREATE POLICY company_domains_delete ON company_domains FOR DELETE
  USING (true);

-- An invitation is visible to its sender and to its recipient (matched by the
-- recipient's current email so an invite works before the account exists).
CREATE POLICY invitations_select ON invitations FOR SELECT
  USING (
    inviter_id = app.current_user_id()
    OR invitee_id = app.current_user_id()
    OR invitee_email = (SELECT lower(u.email) FROM users u WHERE u.id = app.current_user_id())
  );
CREATE POLICY invitations_insert ON invitations FOR INSERT
  WITH CHECK (inviter_id = app.current_user_id());
CREATE POLICY invitations_update ON invitations FOR UPDATE
  USING (
    inviter_id = app.current_user_id()
    OR invitee_id = app.current_user_id()
    OR invitee_email = (SELECT lower(u.email) FROM users u WHERE u.id = app.current_user_id())
  )
  WITH CHECK (true);
CREATE POLICY invitations_delete ON invitations FOR DELETE
  USING (inviter_id = app.current_user_id());

CREATE POLICY user_contacts_select ON user_contacts FOR SELECT
  USING (owner_id = app.current_user_id() OR contact_id = app.current_user_id());
CREATE POLICY user_contacts_insert ON user_contacts FOR INSERT
  WITH CHECK (owner_id = app.current_user_id() OR contact_id = app.current_user_id());
CREATE POLICY user_contacts_delete ON user_contacts FOR DELETE
  USING (owner_id = app.current_user_id() OR contact_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON company_domains TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations     TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_contacts   TO app_user;
