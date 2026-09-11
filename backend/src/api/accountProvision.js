'use strict';

// ---------------------------------------------------------------------------
// Account provisioning shared by every signup path (main-app register and
// Portal A checkout). Keeps the org/workspace bootstrap in one place.
//
// Identity rules (see emailDomain.js):
//   * personal email  -> a PERSONAL "<Name>'s Org" the user owns as ADMIN.
//   * company email   -> joins the COMPANY org already registered for that
//                        domain as EDITOR, or creates it (first user = ADMIN).
//
// Always gives the new user a private "My Workspace" + "Default Project"
// inside their organization so they can start working immediately.
// ---------------------------------------------------------------------------

const { classifyEmail, companyNameFromDomain } = require('./emailDomain');

/**
 * @param {import('pg').PoolClient} client an open transaction client
 * @param {{ userId: string, email: string, displayName: string }} account
 * @returns {Promise<{ orgId: string, orgName: string, orgRole: 'ADMIN'|'EDITOR',
 *   accountType: 'PERSONAL'|'COMPANY', domain: string|null,
 *   joinedExisting: boolean, workspaceId: string }>}
 */
async function provisionNewAccount(client, { userId, email, displayName }) {
  const name = String(displayName || '').trim() || String(email || '').split('@')[0] || 'User';
  const { accountType, domain, isPersonal } = classifyEmail(email);

  let orgId = null;
  let orgRole = 'ADMIN';
  let joinedExisting = false;

  if (!isPersonal) {
    const { rows } = await client.query(
      `SELECT id FROM organizations
        WHERE kind = 'COMPANY' AND domain = $1
        FOR UPDATE`,
      [domain]
    );
    if (rows.length > 0) {
      orgId = rows[0].id;
      orgRole = 'EDITOR';
      joinedExisting = true;
    }
  }

  let orgName;
  if (orgId) {
    const { rows } = await client.query(`SELECT name FROM organizations WHERE id = $1`, [orgId]);
    orgName = rows[0] ? rows[0].name : companyNameFromDomain(domain);
  } else {
    orgName = isPersonal ? `${name}'s Org` : companyNameFromDomain(domain);
    const { rows } = await client.query(
      `INSERT INTO organizations (name, owner_id, kind, domain)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [orgName, userId, accountType, isPersonal ? null : domain]
    );
    orgId = rows[0].id;
  }

  await client.query(
    `INSERT INTO organization_members (org_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [orgId, userId, orgRole]
  );

  const ws = await client.query(
    `INSERT INTO workspaces (organization_id, name, visibility)
     VALUES ($1, $2, 'PRIVATE')
     RETURNING id`,
    [orgId, 'My Workspace']
  );
  const workspaceId = ws.rows[0].id;
  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'ADMIN')`,
    [workspaceId, userId]
  );
  await client.query(`INSERT INTO projects (workspace_id, name) VALUES ($1, $2)`, [
    workspaceId,
    'Default Project',
  ]);

  return { orgId, orgName, orgRole, accountType, domain, joinedExisting, workspaceId };
}

module.exports = { provisionNewAccount };
