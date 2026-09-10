'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getProjectAccess, roleAtLeast, canMutateWorkspace } = require('../access');
const { hashToken } = require('../tokenAuth');

const router = Router();
router.use(requireAuth);

const ALLOWED_SCOPES = new Set(['read', 'write', 'runs', 'sdk']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PREFIX_MARK = 'tkh_';
const TOKEN_PREFIX_LEN = 12;
const TOKEN_BODY_BYTES = 24;

function generateToken() {
  const raw = crypto.randomBytes(TOKEN_BODY_BYTES).toString('hex');
  const token = `${TOKEN_PREFIX_MARK}${raw}`;
  return { token, prefix: token.slice(0, TOKEN_PREFIX_LEN) };
}

function normalizeScopes(scopes) {
  if (scopes === undefined || scopes === null) return ['read'];
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const clean = [];
  for (const s of list) {
    if (typeof s !== 'string' || !ALLOWED_SCOPES.has(s)) return null;
    if (!clean.includes(s)) clean.push(s);
  }
  if (clean.length === 0) return null;
  return clean;
}

function toApiToken(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes || ['read'],
    status: row.status,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    projectId: row.project_id ?? null,
    workspaceId: row.workspace_id ?? null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, prefix, scopes, status, last_used_at, created_at, expires_at, project_id, workspace_id
         FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ tokens: rows.map(toApiToken) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (name.length > 120) return res.status(400).json({ error: 'name must be 120 characters or fewer' });

    const scopes = normalizeScopes(body.scopes);
    if (!scopes) {
      return res.status(400).json({ error: 'scopes must be a subset of read, write, runs and sdk' });
    }

    const projectId = body.projectId != null ? String(body.projectId).trim() : null;
    const workspaceId = body.workspaceId != null ? String(body.workspaceId).trim() : null;
    if (projectId && workspaceId) {
      return res.status(400).json({ error: 'A token can bind to a project OR a workspace, not both' });
    }
    if (body.projectId != null) {
      if (!projectId || !UUID_RE.test(projectId)) {
        return res.status(400).json({ error: 'projectId must be a valid uuid' });
      }
      const access = await getProjectAccess(req.user.id, projectId);
      if (!access || !roleAtLeast(access.level, 'EDITOR')) {
        return res.status(403).json({ error: 'Editor, manager or admin access required for this project' });
      }
    }
    if (body.workspaceId != null) {
      if (!workspaceId || !UUID_RE.test(workspaceId)) {
        return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
      }
      if (!(await canMutateWorkspace(req.user.id, workspaceId))) {
        return res.status(403).json({ error: 'Workspace write access required' });
      }
    }

    let expiresAt = null;
    if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== '') {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'expiresAt must be an ISO date string' });
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'expiresAt must be in the future' });
      }
      expiresAt = parsed.toISOString();
    }

    const { token, prefix } = generateToken();
    const { rows } = await query(
      `INSERT INTO api_tokens (user_id, name, prefix, token_hash, scopes, status, expires_at, project_id, workspace_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
       RETURNING id, name, prefix, scopes, status, last_used_at, created_at, expires_at, project_id, workspace_id`,
      [req.user.id, name, prefix, hashToken(token), scopes, expiresAt, projectId, workspaceId]
    );
    const row = rows[0];
    res.status(201).json({
      token,
      apiToken: toApiToken(row),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE api_tokens SET status = 'revoked', updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Token not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
