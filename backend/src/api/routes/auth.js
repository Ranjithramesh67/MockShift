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
const { allocateUsername } = require('../username');
const { provisionNewAccount } = require('../accountProvision');
const { generateToken, hashToken, expiryFor } = require('../authTokens');
const email = require('../email');

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function selfServiceOpen() {
  // Self-service signup is closed by default: accounts are created through the
  // Portal A plans/checkout flow (which provisions the buyer's org +
  // workspace). Exceptions: the empty-DB bootstrap (very first account ever
  // becomes platform ADMIN) and an explicit opt-in (ALLOW_SELF_SIGNUP=1) for
  // automated test/dev environments — real and preview deployments must never
  // set that flag.
  if (process.env.ALLOW_SELF_SIGNUP === '1') return true;
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  return rows[0].n === 0;
}

async function userSummary(userId) {
  const loaded = await loadUserById(userId);
  if (!loaded) return null;
  const { password_changed_at, ...user } = loaded;
  const { rows: orgs } = await query(
    `SELECT o.id, o.name, o.kind, o.domain,
            (SELECT role FROM organization_members om WHERE om.org_id = o.id AND om.user_id = $1) AS role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
      WHERE om.user_id = $1
      ORDER BY o.kind, o.name`,
    [userId]
  );
  return { user, organizations: orgs };
}

async function issueEmailVerification(userId, to) {
  const raw = generateToken();
  await query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
     VALUES ($1, 'email_verification', $2, $3)`,
    [userId, hashToken(raw), expiryFor('email_verification')]
  );
  const link = `${email.appUrl()}/verify-email?token=${encodeURIComponent(raw)}`;
  await email.sendMail({ to, ...email.verifyEmailMessage(link) });
}

router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name, username } = req.body || {};
    if (!email || !EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!(await selfServiceOpen())) {
      return res.status(403).json({
        error:
          'Self-service signup is closed — choose a plan on the API Hub plans page to create your account',
      });
    }
    const displayName = (name || '').trim() || email.split('@')[0];

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      const exec = (sql, params) => client.query(sql, params);
      const usernameValue = await allocateUsername(exec, { username, email, name: displayName });
      // First user to ever sign up becomes the platform ADMIN (bootstrap).
      const userCount = await client.query('SELECT COUNT(*)::int AS n FROM users');
      const role = userCount.rows[0].n === 0 ? 'ADMIN' : 'EDITOR';
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, name, role, username)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role, username`,
        [email, await hashPassword(password), displayName, role, usernameValue]
      );
      const userId = rows[0].id;

      await provisionNewAccount(client, { userId, email, displayName });
      await client.query('COMMIT');

      try {
        await issueEmailVerification(userId, email);
      } catch (err) {
        console.error('[auth] verification email failed:', err.message);
      }

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

// Lets the main-app /signup page decide whether to show the create-account
// form (open bootstrap / test opt-in) or a gateway to the Portal A plans page.
router.get('/signup-status', async (req, res, next) => {
  try {
    res.json({ open: await selfServiceOpen() });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
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

router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    const { rows } = await query(
      `SELECT id, user_id FROM auth_tokens
        WHERE token_hash = $1 AND kind = 'email_verification'
          AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) {
      return res.status(400).json({ error: 'This verification link is invalid or has expired' });
    }
    await query('UPDATE users SET email_verified = true WHERE id = $1', [row.user_id]);
    await query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', requireAuth, async (req, res, next) => {
  try {
    if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true });
    await query(
      `UPDATE auth_tokens SET used_at = now()
        WHERE user_id = $1 AND kind = 'email_verification' AND used_at IS NULL`,
      [req.user.id]
    );
    await issueEmailVerification(req.user.id, req.user.email);
    res.json({ ok: true });
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
