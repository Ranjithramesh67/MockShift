'use strict';

const crypto = require('crypto');
const { query } = require('./db');
const { loadUserById } = require('./access');

const BEARER_RE = /^Bearer\s+([A-Za-z0-9_\-~+/]+=*)$/;

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
    return res.status(err.status || 401).json({ error: err.message || 'Invalid API token' });
  }
}

module.exports = {
  hashToken,
  readBearerToken,
  findTokenByHash,
  authenticateApiToken,
  resolveApiToken,
  tokenAuth,
};
