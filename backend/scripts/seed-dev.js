'use strict';

// ---------------------------------------------------------------------------
// Dev seed: idempotently recreates the sample data a developer needs to try
// the app right away, directly in the database (no HTTP required):
//
//   1. The three seeded accounts (ADMIN / MANAGER / EDITOR) with real scrypt
//      password hashes so login works, each bootstrapped with an org, a
//      private "My Workspace" and a "Default Project" (mirrors signup).
//   2. A "Mock API Demo" collection under the ADMIN's Default Project with
//      one request per REST method, pointed at the local mock upstream
//      (backend/scripts/mock-upstream.js on port 3999).
//
// Rerunnable: users are upserted, orgs/workspaces/projects/collections are
// only created when missing, and requests are created-or-updated by name.
//
// Usage:
//   cd backend && npm run seed:dev
// ---------------------------------------------------------------------------

const path = require('path');
const { pool } = require('../src/api/db');
const { hashPassword } = require('../src/api/authLib');

const SEED_ACCOUNTS = [
  { email: 'boss1785867669@test.io', password: 'bosspass123', name: 'Boss', role: 'ADMIN' },
  { email: 'pm1785867669@test.io', password: 'pmpass1234', name: 'PM', role: 'MANAGER' },
  { email: 'dev1785867669@test.io', password: 'devpass123', name: 'Dev', role: 'EDITOR' },
];

const MOCK_BASE = process.env.MOCK_UPSTREAM_BASE || 'http://127.0.0.1:3999';

const DEMO_COLLECTION = 'Mock API Demo';
const DEMO_REQUESTS = [
  { name: 'GET all posts', method: 'GET', url: `${MOCK_BASE}/posts`, bodyType: 'NONE', bodyJson: null },
  { name: 'GET post 1', method: 'GET', url: `${MOCK_BASE}/posts/1`, bodyType: 'NONE', bodyJson: null },
  {
    name: 'POST create post',
    method: 'POST',
    url: `${MOCK_BASE}/posts`,
    bodyType: 'JSON',
    bodyJson: { title: 'My new mock post', body: 'created via the request editor', userId: 1 },
  },
  {
    name: 'PUT replace post 1',
    method: 'PUT',
    url: `${MOCK_BASE}/posts/1`,
    bodyType: 'JSON',
    bodyJson: { title: 'Replaced post title', body: 'full replacement via PUT', userId: 2 },
  },
  {
    name: 'PATCH post 1',
    method: 'PATCH',
    url: `${MOCK_BASE}/posts/1`,
    bodyType: 'JSON',
    bodyJson: { title: 'Patched title only' },
  },
  { name: 'DELETE post 2', method: 'DELETE', url: `${MOCK_BASE}/posts/2`, bodyType: 'NONE', bodyJson: null },
  { name: 'GET sample PDF', method: 'GET', url: `${MOCK_BASE}/files/sample.pdf`, bodyType: 'NONE', bodyJson: null },
  { name: 'GET HTML page', method: 'GET', url: `${MOCK_BASE}/html`, bodyType: 'NONE', bodyJson: null },
];

async function ensureUser(client, account) {
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [account.email]);
  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE users SET name = $1, role = $2, password_hash = $3, is_active = true WHERE id = $4`,
      [account.name, account.role, hashPassword(account.password), existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [account.email, hashPassword(account.password), account.name, account.role]
  );
  return rows[0].id;
}

async function ensureOrg(client, userId, displayName) {
  const { rows } = await client.query(
    `SELECT om.org_id FROM organization_members om
      WHERE om.user_id = $1 AND om.role = 'ADMIN'
      ORDER BY om.org_id LIMIT 1`,
    [userId]
  );
  if (rows.length > 0) return rows[0].org_id;
  const org = await client.query(
    `INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING id`,
    [`${displayName}'s Org`, userId]
  );
  const orgId = org.rows[0].id;
  await client.query(
    `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
    [orgId, userId]
  );
  return orgId;
}

async function ensureWorkspaceAndProject(client, userId, orgId) {
  const { rows: owned } = await client.query(
    `SELECT wm.workspace_id FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1 AND w.organization_id = $2 AND wm.role = 'ADMIN'
      ORDER BY w.name LIMIT 1`,
    [userId, orgId]
  );
  let workspaceId;
  if (owned.length > 0) {
    workspaceId = owned[0].workspace_id;
  } else {
    const ws = await client.query(
      `INSERT INTO workspaces (organization_id, name, visibility) VALUES ($1, 'My Workspace', 'PRIVATE') RETURNING id`,
      [orgId]
    );
    workspaceId = ws.rows[0].id;
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
      [workspaceId, userId]
    );
  }
  const { rows: proj } = await client.query(
    `SELECT id FROM projects WHERE workspace_id = $1 AND name = 'Default Project' LIMIT 1`,
    [workspaceId]
  );
  if (proj.length === 0) {
    await client.query(
      `INSERT INTO projects (workspace_id, name) VALUES ($1, 'Default Project')`,
      [workspaceId]
    );
  }
  return workspaceId;
}

async function ensureDemoCollection(client) {
  const { rows: admins } = await client.query(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [SEED_ACCOUNTS[0].email]
  );
  if (admins.length === 0) return;
  const adminId = admins[0].id;

  const { rows: proj } = await client.query(
    `SELECT p.id FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = $1 AND p.name = 'Default Project'
      LIMIT 1`,
    [adminId]
  );
  if (proj.length === 0) return;
  const projectId = proj[0].id;

  const { rows: cols } = await client.query(
    `SELECT id FROM collections WHERE project_id = $1 AND name = $2 LIMIT 1`,
    [projectId, DEMO_COLLECTION]
  );
  let collectionId;
  if (cols.length > 0) {
    collectionId = cols[0].id;
  } else {
    const col = await client.query(
      `INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id`,
      [projectId, DEMO_COLLECTION]
    );
    collectionId = col.rows[0].id;
  }

  for (const r of DEMO_REQUESTS) {
    const { rows: existing } = await client.query(
      `SELECT id FROM api_requests WHERE collection_id = $1 AND name = $2 LIMIT 1`,
      [collectionId, r.name]
    );
    const values = [r.method, r.url, r.bodyType, r.bodyJson];
    if (existing.length > 0) {
      await client.query(
        `UPDATE api_requests SET method = $2, url = $3, body_type = $4, body_json = $5
          WHERE id = $1`,
        [existing[0].id, ...values]
      );
    } else {
      await client.query(
        `INSERT INTO api_requests
           (collection_id, name, method, url, headers, query_params, body_type, body_json)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, $5, $6)`,
        [collectionId, r.name, ...values]
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[seed:dev] collection "${DEMO_COLLECTION}" ready (${collectionId}) with ${DEMO_REQUESTS.length} requests`);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const account of SEED_ACCOUNTS) {
      const userId = await ensureUser(client, account);
      const orgId = await ensureOrg(client, userId, account.name);
      await ensureWorkspaceAndProject(client, userId, orgId);
      // eslint-disable-next-line no-console
      console.log(`[seed:dev] ${account.email} (${account.role}) ready`);
    }
    await ensureDemoCollection(client);
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log('[seed:dev] done — sample data retained in the dev DB');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed:dev] failed:', err.message);
  process.exit(1);
});
