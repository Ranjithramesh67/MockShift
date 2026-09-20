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
const { syncCompanyOrg } = require('../companyNetwork');
const { generateToken, hashToken, expiryFor, createThrottle } = require('../authTokens');
const { issueEmailVerification } = require('../emailVerification');
const { pendingPaymentFor, paymentRequiredBody } = require('../paymentGate');
const email = require('../email');

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const forgotThrottle = createThrottle({ windowMs: 15 * 60 * 1000, max: 5 });

async function selfServiceOpen() {
  // Self-service signup is closed by default: accounts are created through the
  // Portal A plans/checkout flow (which provisions the buyer's org +
  // workspace). Exceptions: the empty-DB bootstrap (very first account ever
  // becomes platform ADMIN) and an explicit opt-in (ALLOW_SELF_SIGNUP=1) for
  // automated test/dev environments.
  //
  // The opt-in is deliberately ignored under NODE_ENV=production: a stray
  // ALLOW_SELF_SIGNUP left in a real deployment would let visitors create an
  // account that skips the plans page entirely — no plan is chosen and none is
  // attached — which is exactly what the plans gateway exists to prevent.
  if (process.env.ALLOW_SELF_SIGNUP === '1' && process.env.NODE_ENV !== 'production') {
    return true;
  }
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  return rows[0].n === 0;
}

async function userSummary(userId, pendingPayment = null) {
  const loaded = await loadUserById(userId);
  if (!loaded) return null;
  const { password_changed_at, session_epoch, ...user } = loaded;
  const { rows: orgs } = await query(
    `SELECT o.id, o.name, o.kind, o.domain,
            (SELECT role FROM organization_members om WHERE om.org_id = o.id AND om.user_id = $1) AS role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
      WHERE om.user_id = $1
      ORDER BY o.kind, o.name`,
    [userId]
  );
  return {
    user,
    organizations: orgs,
    payment_required: Boolean(pendingPayment),
    pending_order: pendingPayment || null,
  };
}

router.post('/signup', async (req, res, next) => {
  try {
    const { email: rawEmail, password, name, username } = req.body || {};
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
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

    const existing = await query('SELECT id FROM users WHERE lower(email) = $1', [email]);
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
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role, username, session_epoch`,
        [email, await hashPassword(password), displayName, role, usernameValue]
      );
      const userId = rows[0].id;

      await provisionNewAccount(client, { userId, email, displayName });
      await client.query('COMMIT');

      let emailVerification = 'sent';
      try {
        const sent = await issueEmailVerification(userId, email);
        if (sent && sent.skipped) emailVerification = 'not_configured';
        else if (sent && sent.error) emailVerification = 'failed';
      } catch (err) {
        emailVerification = 'failed';
        console.error('[auth] verification email failed:', err.message);
      }

      res.setHeader('Set-Cookie', sessionCookie(createSessionToken(userId, rows[0].session_epoch)));
      res.status(201).json({ user: await userSummary(userId), emailVerification });
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
    const { email: rawEmail, password } = req.body || {};
    const email = String(rawEmail || '').trim().toLowerCase();
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }
    // Real-gateway payment gate: a customer who created an account at checkout
    // but has not paid yet may not sign in until the order is confirmed. The
    // 402 body carries the pending order so the client can route them to the
    // payment page to finish.
    const pendingPayment = await pendingPaymentFor(user);
    if (pendingPayment) {
      return res.status(402).json(paymentRequiredBody(pendingPayment));
    }
    // A domain registered by an admin after this account was created should
    // still pull the user into their company organization. Best-effort: a
    // failure here must never block an otherwise valid login.
    try {
      await syncCompanyOrg({ userId: user.id, email: user.email });
    } catch (err) {
      console.error('[auth] company sync failed:', err.message);
    }
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken(user.id, user.session_epoch)));
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
      `UPDATE auth_tokens SET used_at = now()
        WHERE token_hash = $1 AND kind = 'email_verification'
          AND used_at IS NULL AND expires_at > now()
        RETURNING id, user_id`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) {
      return res.status(400).json({ error: 'This verification link is invalid or has expired' });
    }
    await query('UPDATE users SET email_verified = true WHERE id = $1', [row.user_id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', requireAuth, async (req, res, next) => {
  try {
    if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true });
    // Refuse before invalidating the outstanding token: a server without SMTP
    // must not burn the user's existing link and then report a send that never
    // happened (the "Resend email" button gave silent no-op success before).
    if (!email.isConfigured()) {
      return res.status(503).json({
        error: 'Email delivery is not configured on this server — ask an administrator to set SMTP.',
        code: 'smtp_not_configured',
      });
    }
    await query(
      `UPDATE auth_tokens SET used_at = now()
        WHERE user_id = $1 AND kind = 'email_verification' AND used_at IS NULL`,
      [req.user.id]
    );
    const sent = await issueEmailVerification(req.user.id, req.user.email);
    if (sent && sent.error) {
      return res.status(502).json({
        error: 'Could not send the verification email — please try again later.',
        code: 'smtp_send_failed',
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const address = String((req.body || {}).email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(address)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    // Always answer the same way, and only send/act within the throttle, so the
    // endpoint cannot be used to enumerate accounts or spam a mailbox. The DB
    // work and mail send are detached from the response so their timing cannot
    // be observed by the caller.
    const allowed = forgotThrottle.allow(address.toLowerCase());
    res.json({ ok: true });
    if (!allowed) return;
    void (async () => {
      try {
        const { rows } = await query(
          'SELECT id, email FROM users WHERE lower(email) = $1 AND is_active = true',
          [address]
        );
        if (!rows[0]) return;
        const client = await require('../db').pool.connect();
        let raw;
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE auth_tokens SET used_at = now()
              WHERE user_id = $1 AND kind = 'password_reset' AND used_at IS NULL`,
            [rows[0].id]
          );
          raw = generateToken();
          await client.query(
            `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
             VALUES ($1, 'password_reset', $2, $3)`,
            [rows[0].id, hashToken(raw), expiryFor('password_reset')]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        const link = `${email.appUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
        await email.sendMail({ to: rows[0].email, ...email.passwordResetMessage(link) });
      } catch (err) {
        console.error('[auth] forgot-password failed:', err && err.message);
      }
    })();
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, new_password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    if (!new_password || String(new_password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const { rows } = await query(
      `SELECT id, user_id FROM auth_tokens
        WHERE token_hash = $1 AND kind = 'password_reset'
          AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    if (!rows[0]) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    const passwordHash = await hashPassword(new_password);
    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `UPDATE auth_tokens SET used_at = now()
          WHERE id = $1 AND used_at IS NULL
          RETURNING user_id`,
        [rows[0].id]
      );
      if (!claimed.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This reset link is invalid or has expired' });
      }
      await client.query(
        `UPDATE users
            SET password_hash = $1, password_changed_at = now(), session_epoch = session_epoch + 1
          WHERE id = $2`,
        [passwordHash, claimed.rows[0].user_id]
      );
      await client.query(
        `UPDATE auth_tokens SET used_at = now()
          WHERE user_id = $1 AND kind = 'password_reset' AND used_at IS NULL`,
        [claimed.rows[0].user_id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
    res.json(await userSummary(req.user.id, req.pendingPayment || null));
  } catch (err) {
    next(err);
  }
});

router.get('/session', async (req, res, next) => {
  try {
    const payload = verifySession(readSessionToken(req));
    if (!payload) return res.json({ authenticated: false });
    const user = await loadUserById(payload.userId);
    if (!user || !user.is_active) return res.json({ authenticated: false });
    if (typeof payload.sv === 'number' && typeof user.session_epoch === 'number' && payload.sv !== user.session_epoch) {
      return res.json({ authenticated: false });
    }
    const pending = await pendingPaymentFor(user);
    res.json({ authenticated: true, payment_required: Boolean(pending) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
