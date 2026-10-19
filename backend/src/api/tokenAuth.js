'use strict';

const crypto = require('crypto');
const { query } = require('./db');
const { loadUserById } = require('./access');

const BEARER_RE = /^Bearer\s+([A-Za-z0-9_\-~+/]+=*)$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function readBearerToken(req) {
  const header = req.headers && req.headers.authorization;
  if (!header) return null;
  const m = BEARER_RE.exec(header);
  return m ? m[1] : null;
}

async function findTokenByHash(tokenHash) {
  const { rows } = await query(
    `SELECT id, user_id, name, prefix, scopes, status, last_used_at, expires_at, created_at, updated_at,
            project_id, workspace_id
       FROM api_tokens WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

function apiTokenError(message) {
  const err = new Error(message);
  err.status = 401;
  err.code = 'invalid_api_token';
  return err;
}

/**
 * Authenticate a raw API token. Returns null when no Authorization: Bearer
 * header is present (caller decides whether to fall back to session auth).
 * Throws a 401 ApiTokenError when the header IS present but the token is
 * unknown, revoked, expired or its owning user is missing/inactive.
 *
 * On success the token's last_used_at is refreshed (throttled to ~60s so
 * read-heavy loops do not hammer the table).
 */
async function authenticateApiToken(req) {
  const raw = readBearerToken(req);
  if (!raw) return null;
  const token = await findTokenByHash(hashToken(raw));
  if (!token) throw apiTokenError('Invalid API token');
  if (token.status !== 'active') throw apiTokenError('API token is revoked');
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    throw apiTokenError('API token has expired');
  }
  const user = await loadUserById(token.user_id);
  if (!user || !user.is_active) throw apiTokenError('Invalid API token');
  if (!token.last_used_at || Date.now() - new Date(token.last_used_at).getTime() > 60000) {
    await query(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [token.id]).catch(() => {});
  }
  return { user, token };
}

/**
 * Lenient resolver: returns the owning user for a valid Bearer token, or null
 * when the header is absent OR the token is invalid. Coordinators that accept
 * either session OR token auth call this first and fall back to the session
 * when it returns null.
 */
async function resolveApiToken(req) {
  try {
    const auth = await authenticateApiToken(req);
    return auth ? auth.user : null;
  } catch {
    return null;
  }
}

function isRunRequest(req) {
  if (req.method !== 'POST') return false;
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  return /\/run$/.test(path) || /\/runs$/.test(path);
}

// The SDK sync endpoint is a write that carries no resource id in its path: it
// resolves the target project/workspace from the token binding itself (and
// rejects a token whose binding no longer exists). Binding enforcement here
// would reject every bound token before the route can do that.
function isSdkSync(req) {
  if (req.method !== 'POST') return false;
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  return /^\/api\/sdk\/sync$/.test(path);
}

/**
 * Check a token's scopes against the request it is trying to make. Returns
 * null when the request is allowed, or a `{ status, error }` object otherwise.
 *
 * The scope model:
 *   * `write` — full access (the default token used by S4 machine clients).
 *   * `read`  — safe (GET/HEAD/OPTIONS) requests only.
 *   * `runs`  — may also POST to the request-run endpoints.
 *   * `sdk`   — may also call the SDK sync endpoints.
 *
 * Without this central check a `read`-scope token could create, modify and
 * delete content, because requireAuth only verified the token resolved to a
 * valid user.
 */
function apiTokenScopeError(req) {
  const token = req.apiToken;
  if (!token) return null;
  const scopes = Array.isArray(token.scopes) ? token.scopes : [];
  if (scopes.includes('write')) return null;
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  if (scopes.includes('read') && SAFE_METHODS.has(req.method)) return null;
  if (scopes.includes('runs') && isRunRequest(req)) return null;
  if (scopes.includes('sdk') && /\/sdk(\/|$)/.test(path)) return null;
  return { status: 403, error: 'API token scope does not permit this operation' };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstUuid(...values) {
  return values.find((v) => typeof v === 'string' && UUID_RE.test(v)) || null;
}

/**
 * Extract resource ids from the URL path. Router-level auth middleware runs
 * before Express has populated `req.params`, so path-based targets must be
 * recovered from the path itself.
 */
function idsFromPath(req) {
  const raw = req.originalUrl || req.url || '';
  const path = raw.split('?')[0];
  const match = (segment) => {
    const m = new RegExp(`/api/${segment}/([^/]+)`).exec(path);
    return m ? firstUuid(m[1]) : null;
  };
  return {
    projectId: match('projects'),
    collectionId: match('collections'),
    folderId: match('folders'),
    requestId: match('requests'),
    environmentId: match('environments'),
    workspaceId: match('workspaces'),
  };
}

/**
 * Best-effort resolution of the project/workspace a request targets, from its
 * route params and (for create routes) its body. Returns null when the request
 * does not reference a specific resource.
 */
async function resolveBindingTarget(req) {
  const params = req.params || {};
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const fromPath = idsFromPath(req);
  const projectId = firstUuid(params.projectId, body.projectId, fromPath.projectId);
  const collectionId = firstUuid(params.collectionId, body.collectionId, fromPath.collectionId);
  const folderId = firstUuid(params.folderId, body.folderId, fromPath.folderId);
  const requestId = firstUuid(params.requestId, body.requestId, body.id, fromPath.requestId);
  const environmentId = firstUuid(params.environmentId, body.environmentId, fromPath.environmentId);
  const workspaceId = firstUuid(params.workspaceId, body.workspaceId, fromPath.workspaceId);

  if (projectId) {
    const { rows } = await query(`SELECT workspace_id FROM projects WHERE id = $1`, [projectId]);
    return { projectId, workspaceId: rows[0] ? rows[0].workspace_id : null };
  }
  if (collectionId) {
    const { rows } = await query(
      `SELECT p.id AS project_id,
              COALESCE(c.workspace_id, p.workspace_id) AS workspace_id
         FROM collections c JOIN projects p ON p.id = c.project_id
        WHERE c.id = $1`,
      [collectionId]
    );
    return rows[0] ? { projectId: rows[0].project_id, workspaceId: rows[0].workspace_id } : null;
  }
  if (folderId) {
    const { rows } = await query(
      `SELECT p.id AS project_id,
              COALESCE(c.workspace_id, p.workspace_id) AS workspace_id
         FROM folders f
         JOIN collections c ON c.id = f.collection_id
         JOIN projects p ON p.id = c.project_id
        WHERE f.id = $1`,
      [folderId]
    );
    return rows[0] ? { projectId: rows[0].project_id, workspaceId: rows[0].workspace_id } : null;
  }
  if (requestId) {
    const { rows } = await query(
      `SELECT p.id AS project_id,
              COALESCE(c.workspace_id, p.workspace_id) AS workspace_id
         FROM api_requests rq
         JOIN collections c ON c.id = rq.collection_id
         JOIN projects p ON p.id = c.project_id
        WHERE rq.id = $1`,
      [requestId]
    );
    return rows[0] ? { projectId: rows[0].project_id, workspaceId: rows[0].workspace_id } : null;
  }
  if (environmentId) {
    const { rows } = await query(
      `SELECT e.workspace_id, w.project_id
         FROM environments e
         LEFT JOIN workspaces w ON w.id = e.workspace_id
        WHERE e.id = $1`,
      [environmentId]
    );
    return rows[0]
      ? { projectId: rows[0].project_id || null, workspaceId: rows[0].workspace_id }
      : null;
  }
  if (workspaceId) {
    const { rows } = await query(`SELECT project_id FROM workspaces WHERE id = $1`, [workspaceId]);
    return { projectId: (rows[0] && rows[0].project_id) || null, workspaceId };
  }
  return null;
}

/**
 * Enforce a token's project/workspace binding. A project-bound token may only
 * touch resources in that project; a workspace-bound token only resources in
 * that workspace. Unbound tokens are unaffected. Safe requests that reference
 * no specific resource (e.g. GET /api/tokens or /api/me) stay allowed so token
 * introspection keeps working; every write and every targeted request outside
 * the binding is rejected.
 */
async function apiTokenBindingError(req) {
  const token = req.apiToken;
  if (!token) return null;
  const boundProject = token.project_id || null;
  const boundWorkspace = token.workspace_id || null;
  if (!boundProject && !boundWorkspace) return null;

  const target = await resolveBindingTarget(req);
  if (target) {
    if (boundProject && target.projectId === boundProject) return null;
    if (boundWorkspace && target.workspaceId === boundWorkspace) return null;
  } else if (SAFE_METHODS.has(req.method) || isSdkSync(req)) {
    return null;
  }
  return { status: 403, error: 'API token is bound to a different project or workspace' };
}

/**
 * Express middleware for endpoints that ONLY accept API-token auth: responds
 * 401 when the header is missing or the token is invalid.
 */
async function tokenAuth(req, res, next) {
  try {
    const auth = await authenticateApiToken(req);
    if (!auth) return res.status(401).json({ error: 'API token required' });
    req.user = auth.user;
    req.apiToken = auth.token;
    next();
  } catch (err) {
    if (err && err.code === 'invalid_api_token') {
      return res.status(401).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = {
  hashToken,
  readBearerToken,
  findTokenByHash,
  authenticateApiToken,
  resolveApiToken,
  apiTokenScopeError,
  apiTokenBindingError,
  tokenAuth,
};
