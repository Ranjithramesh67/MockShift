-- ============================================================================
-- API Hub — 059_iam_roles.sql
--
-- Organization-scoped IAM roles, layered additively on top of the legacy
-- ADMIN/MANAGER/EDITOR/VIEWER/SUPPORT enum stored per membership scope.
--
-- The legacy enum keeps working untouched: this migration does not alter
-- organization_members, and the app mirrors the highest-ranked system role
-- back onto organization_members.role when assigning IAM roles.
--
-- Tables:
--   iam_roles             — a named role, system (seeded) or custom (user-made)
--   iam_role_permissions  — permission catalog keys granted to a role
--   iam_member_roles      — assigns a role to an org member (many-to-many)
--
-- Idempotent + additive: CREATE ... IF NOT EXISTS and ON CONFLICT DO NOTHING,
-- so replaying the migration is a safe no-op. No RLS (matches the legacy
-- organization_members table). No destructive statements.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS iam_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  system_key      text,
  is_system       boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Role names are unique per organization, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS iam_roles_org_lower_name_uidx
  ON iam_roles (organization_id, lower(name));

-- System roles are identified by (org, system_key); custom roles leave it NULL.
CREATE UNIQUE INDEX IF NOT EXISTS iam_roles_org_system_key_uidx
  ON iam_roles (organization_id, system_key)
  WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS iam_role_permissions (
  role_id        uuid NOT NULL REFERENCES iam_roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS iam_member_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         uuid NOT NULL REFERENCES iam_roles(id) ON DELETE CASCADE,
  granted_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS iam_member_roles_user_idx ON iam_member_roles (user_id);
CREATE INDEX IF NOT EXISTS iam_member_roles_org_idx  ON iam_member_roles (organization_id);

-- ---------------------------------------------------------------- Backfill 1
-- Seed the five system roles for every existing organization.
INSERT INTO iam_roles (organization_id, name, description, system_key, is_system)
SELECT o.id, v.name, v.description, v.system_key, true
  FROM organizations o
 CROSS JOIN (VALUES
   ('ADMIN',   'Full control of the organization',            'ADMIN'),
   ('Manager', 'Manage projects, workspaces and members',     'MANAGER'),
   ('Editor',  'Create and edit requests and collections',    'EDITOR'),
   ('Viewer',  'Read-only access',                            'VIEWER'),
   ('Support', 'Read access plus audit visibility',           'SUPPORT')
 ) AS v(name, description, system_key)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- Backfill 2
-- Mirror every existing legacy org membership into an IAM system-role grant.
INSERT INTO iam_member_roles (organization_id, user_id, role_id)
SELECT om.org_id, om.user_id, r.id
  FROM organization_members om
  JOIN iam_roles r
    ON r.organization_id = om.org_id
   AND r.system_key = om.role::text
   AND r.is_system
ON CONFLICT (organization_id, user_id, role_id) DO NOTHING;

COMMIT;
