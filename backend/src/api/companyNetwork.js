'use strict';

// ---------------------------------------------------------------------------
// Organization network resolution.
//
// Bridges the admin-maintained `company_domains` registry (company name + email
// domain) and org membership:
//   * signup        -> accountProvision consults the registry so a registered
//                      company gets its human name and linked organization;
//   * login         -> syncCompanyOrg adds a pre-existing user to the company
//                      organization after a domain is registered later;
//   * directory     -> companyOrgForUser tells the People view whether to scope
//                      to the user's organization or to personal contacts.
//
// All functions accept an optional transaction `client` so the signup path can
// reuse its open BEGIN/COMMIT and everything else falls back to the pool.
// ---------------------------------------------------------------------------

const { query: poolQuery } = require('./db');
const {
  normalizeEmailDomain,
  isPersonalDomain,
  companyNameFromDomain,
} = require('./emailDomain');

function runner(client) {
  if (client) return (sql, params) => client.query(sql, params);
  return (sql, params) => poolQuery(sql, params);
}

/** The registry row for a normalized domain, or null. */
async function lookupRegisteredCompany(run, domain) {
  if (!domain) return null;
  const { rows } = await run(
    `SELECT id, company_name, organization_id FROM company_domains WHERE domain = $1`,
    [domain]
  );
  return rows[0] || null;
}

/** Point a registry row at the organization that serves its domain. */
async function linkRegisteredCompany(run, domain, orgId) {
  if (!domain || !orgId) return;
  await run(
    `UPDATE company_domains SET organization_id = $1
      WHERE domain = $2 AND (organization_id IS NULL OR organization_id <> $1)`,
    [orgId, domain]
  );
}

/**
 * Ensure `userId` is a member of the company organization for their email
 * domain, creating the organization (and linking the registry row) when needed.
 *
 * Safe to call on every login: it is a no-op for personal domains and for users
 * who are already members. Never creates a workspace — signup handles the
 * "start working immediately" bootstrap; this only fixes membership.
 *
 * @returns {Promise<{ accountType:'PERSONAL'|'COMPANY', domain:string|null,
 *   orgId:string|null, orgName:(string|null), role:(string|null),
 *   joined:boolean, created:boolean }>}
 */
async function syncCompanyOrg({ client = null, userId, email }) {
  const run = runner(client);
  const domain = normalizeEmailDomain(email);
  if (!domain || isPersonalDomain(domain)) {
    return { accountType: 'PERSONAL', domain: null, orgId: null, orgName: null, role: null, joined: false, created: false };
  }

  const registered = await lookupRegisteredCompany(run, domain);
  let orgId = registered && registered.organization_id ? registered.organization_id : null;

  if (!orgId) {
    const { rows } = await run(
      `SELECT id FROM organizations WHERE kind = 'COMPANY' AND domain = $1`,
      [domain]
    );
    if (rows[0]) orgId = rows[0].id;
  }

  let created = false;
  const orgName = (registered && registered.company_name) || companyNameFromDomain(domain);
  if (!orgId) {
    const { rows } = await run(
      `INSERT INTO organizations (name, owner_id, kind, domain)
       VALUES ($1, $2, 'COMPANY', $3)
       RETURNING id`,
      [orgName, userId, domain]
    );
    orgId = rows[0].id;
    created = true;
  }
  if (registered && !registered.organization_id) {
    await linkRegisteredCompany(run, domain, orgId);
  }

  const { rows: existing } = await run(
    `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId]
  );
  if (existing[0]) {
    return { accountType: 'COMPANY', domain, orgId, orgName, role: existing[0].role, joined: false, created };
  }

  const { rows: counts } = await run(
    `SELECT COUNT(*)::int AS n FROM organization_members WHERE org_id = $1`,
    [orgId]
  );
  const role = counts[0].n === 0 ? 'ADMIN' : 'EDITOR';
  await run(
    `INSERT INTO organization_members (org_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [orgId, userId, role]
  );
  return { accountType: 'COMPANY', domain, orgId, orgName, role, joined: true, created };
}

/**
 * The COMPANY organization a user belongs to, or null when they are an
 * individual (or only in PERSONAL orgs). Used to scope the directory.
 */
async function companyOrgForUser(userId) {
  const { rows } = await poolQuery(
    `SELECT o.id, o.name, o.domain
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
      WHERE om.user_id = $1 AND o.kind = 'COMPANY'
      ORDER BY o.created_at ASC NULLS LAST
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  lookupRegisteredCompany,
  linkRegisteredCompany,
  syncCompanyOrg,
  companyOrgForUser,
};
