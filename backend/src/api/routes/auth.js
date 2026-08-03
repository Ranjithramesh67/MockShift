'use strict';

const { Router } = require('express');
const { query } = require('../db');
const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  sessionCookie,
  clearSessionCookie,
  readSessionToken,
  verifySession,
} = require('../authLib');
const { requireAuth, loadUserById } = require('../access');

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function userSummary(userId) {
  const user = await loadUserById(userId);
  if (!user) return null;
  const { rows: orgs } = await query(
    `SELECT o.id, o.name,
            (SELECT role FROM organization_members om WHERE om.org_id = o.id AND om.user_id = $1) AS role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
      WHERE om.user_id = $1
      ORDER BY o.name`,
    [userId]
  );
  return { user, organizations: orgs };
}

router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const displayName = (name || '').trim() || email.split('@')[0];

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      // First user to ever sign up becomes the platform ADMIN (bootstrap).
      const userCount = await client.query('SELECT COUNT(*)::int AS n FROM users');
      const role = userCount.rows[0].n === 0 ? 'ADMIN' : 'EDITOR';
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4) RETURNING id, email, name, role`,
        [email, hashPassword(password), displayName, role]
      );
      const userId = rows[0].id;

      const org = await client.query(
        `INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [`${displayName}'s Org`, userId]
      );
      const orgId = org.rows[0].id;
      await client.query(
        `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
        [orgId, userId]
      );
      const ws = await client.query(
        `INSERT INTO workspaces (organization_id, name, visibility) VALUES ($1, $2, 'PRIVATE') RETURNING id`,
        [orgId, 'My Workspace']
      );
      const wsId = ws.rows[0].id;
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
        [wsId, userId]
      );
      await client.query(
        `INSERT INTO projects (workspace_id, name) VALUES ($1, $2)`,
        [wsId, 'Default Project']
      );
      await client.query('COMMIT');

      res.setHeader('Set-Cookie', sessionCookie(createSessionToken(userId)));
      res.status(201).json({ user: await userSummary(userId) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken(user.id)));
    res.json({ user: await userSummary(user.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await userSummary(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.get('/session', async (req, res) => {
  const payload = verifySession(readSessionToken(req));
  res.json({ authenticated: Boolean(payload) });
});

module.exports = router;
