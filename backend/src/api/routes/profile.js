'use strict';

// PR-1 profile surface. Session-scoped self-service endpoints on the MAIN
// backend — owner is always the authenticated user (requireAuth); no portal
// RBAC involved (checkout-created customers are global EDITOR and sit outside
// the portal role system).
//
//  - GET    /api/profile        user (+avatar) + orgs + resolved current
//                               subscription + plan limits snapshot (for later
//                               usage bars, L5)
//  - PATCH  /api/profile        update name / username (email is read-only:
//                               it is the login id, decision D2)
//  - POST   /api/profile/avatar set preset key / upload base64 (<= 2 MB) /
//                               remove
//  - GET    /api/profile/avatar serve the uploaded image (when present)
//  - POST   /api/profile/password  change password (verify current first)
//
// Subscriptions/plans live in portal tables of the same shared apihub DB and
// are read-only here. Plan changes stay on the Portal A checkout (A5 single-
// plan supersede rule); this route only surfaces the current state.

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');
const { hashPassword, verifyPassword } = require('../authLib');
const { usernameError } = require('../username');

const router = Router();
router.use(requireAuth);

const USER_PROFILE_COLUMNS = `id, email, username, name, role, is_active,
  created_at, avatar_key, avatar_data IS NOT NULL AS avatar_uploaded,
  avatar_type, avatar_updated_at`;

const PRESET_RE = /^[A-Za-z0-9_-]{1,48}$/;
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // ~2 MB cap (decision D3: DB bytea)

// Newest non-terminal subscription: ACTIVE/TRIALING first, then
// PAST_DUE/SUSPENDED; mirrors Portal A /account/overview resolution.
const SUB_COLUMNS = `s.id, s.status, s.billing_cycle, s.current_period_start,
  s.current_period_end, s.trial_ends_at, s.cancel_at_period_end, s.cancelled_at,
  s.created_at, p.id AS plan_id, p.key AS plan_key, p.name AS plan_name,
  p.currency AS plan_currency, p.limits AS plan_limits`;

function toAvatarShape(r) {
  return {
    preset_key: r.avatar_key || null,
    uploaded: Boolean(r.avatar_uploaded),
    mime: r.avatar_type || null,
    updated_at: r.avatar_updated_at || null,
  };
}

function toSubscriptionShape(r) {
  return {
    id: r.id,
    status: r.status,
    billing_cycle: r.billing_cycle,
    plan: { id: r.plan_id, key: r.plan_key, name: r.plan_name, currency: r.plan_currency },
    current_period_start: r.current_period_start,
    current_period_end: r.current_period_end,
    trial_ends_at: r.trial_ends_at,
    cancel_at_period_end: r.cancel_at_period_end,
    cancelled_at: r.cancelled_at,
    created_at: r.created_at,
  };
}

async function loadProfile(userId) {
  const { rows: userRows } = await query(
    `SELECT ${USER_PROFILE_COLUMNS} FROM users WHERE id = $1`,
    [userId]
  );
  const row = userRows[0];
  if (!row) return null;

  const { rows: orgs } = await query(
    `SELECT o.id, o.name,
            (SELECT role FROM organization_members om
              WHERE om.org_id = o.id AND om.user_id = $1) AS role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
      WHERE om.user_id = $1
      ORDER BY o.name`,
    [userId]
  );

  const { rows: subRows } = await query(
    `SELECT ${SUB_COLUMNS}
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = $1
        AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'SUSPENDED')
      ORDER BY (s.status IN ('ACTIVE', 'TRIALING')) DESC, s.created_at DESC
      LIMIT 1`,
    [userId]
  );
  const subscription = subRows[0] ? toSubscriptionShape(subRows[0]) : null;
  const plan_limits = subRows[0] ? subRows[0].plan_limits : null;

  return {
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      name: row.name,
      role: row.role,
      is_active: row.is_active,
      created_at: row.created_at,
      avatar: toAvatarShape(row),
    },
    organizations: orgs,
    subscription,
    plan_limits,
  };
}

async function respondProfile(userId, res) {
  const profile = await loadProfile(userId);
  if (!profile) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ ok: true, ...profile });
}

router.get('/', async (req, res, next) => {
  try {
    await respondProfile(req.user.id, res);
  } catch (err) {
    next(err);
  }
});

router.patch('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const allowed = new Set(['name', 'username']);
    const provided = Object.keys(body).filter((k) => body[k] !== undefined);
    const unknown = provided.filter((k) => !allowed.has(k));
    if (provided.includes('email')) {
      return res.status(400).json({ error: 'Email is read-only — it is your login id (D2)' });
    }
    if (unknown.length > 0) {
      return res.status(400).json({ error: `Field(s) not editable: ${unknown.join(', ')}` });
    }
    if (provided.length === 0) {
      return res.status(400).json({ error: 'Nothing to update — send name and/or username' });
    }

    const sets = [];
    const params = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ error: 'Name is required' });
      if (name.length > 120) return res.status(400).json({ error: 'Name must be 120 characters or fewer' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }

    if (body.username !== undefined) {
      const username = String(body.username).trim();
      const usernameErr = usernameError(username);
      if (usernameErr) return res.status(400).json({ error: usernameErr });
      const { rows: dup } = await query(
        `SELECT id FROM users WHERE lower(username) = lower($1) AND id <> $2`,
        [username, req.user.id]
      );
      if (dup.length > 0) {
        return res.status(409).json({ error: 'That username is already taken' });
      }
      params.push(username);
      sets.push(`username = $${params.length}`);
    }

    params.push(req.user.id);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    await respondProfile(req.user.id, res);
  } catch (err) {
    next(err);
  }
});

function avatarShapeFromRow(row) {
  return {
    preset_key: row.avatar_key || null,
    uploaded: Boolean(row.avatar_data),
    mime: row.avatar_type || null,
    updated_at: row.avatar_updated_at || null,
  };
}

async function setAvatar(userId, fields, res) {
  const { rows } = await query(
    `UPDATE users
        SET avatar_key = $2, avatar_data = $3, avatar_type = $4,
            avatar_updated_at = now()
      WHERE id = $1
      RETURNING avatar_key, avatar_data IS NOT NULL AS uploaded,
                avatar_type, avatar_updated_at`,
    [userId, fields.key, fields.data, fields.mime]
  );
  const row = rows[0];
  res.json({
    ok: true,
    avatar: {
      preset_key: row.avatar_key || null,
      uploaded: row.uploaded,
      mime: row.avatar_type || null,
      updated_at: row.avatar_updated_at,
    },
  });
}

router.post('/avatar', async (req, res, next) => {
  try {
    const body = req.body || {};

    // remove clears preset + upload entirely.
    if (body.remove === true) {
      return await setAvatar(req.user.id, { key: null, data: null, mime: null }, res);
    }

    // Upload a base64 image (decided by D3: stored in DB, served by this route).
    if (body.data !== undefined) {
      const mime = String(body.mime || '').toLowerCase();
      if (!ALLOWED_IMAGE_MIME.has(mime)) {
        return res.status(400).json({
          error: 'Unsupported image type — use image/png, image/jpeg, image/gif or image/webp',
        });
      }
      const base64 = String(body.data).replace(/\s+/g, '');
      let buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        buffer = null;
      }
      if (!buffer || buffer.length === 0 || base64.length < buffer.length * 0.5) {
        return res.status(400).json({ error: 'Invalid base64 image data' });
      }
      if (buffer.length > MAX_AVATAR_BYTES) {
        return res.status(400).json({ error: 'Avatar image must be 2 MB or smaller' });
      }
      // A preset key + upload are mutually exclusive: upload wins.
      return await setAvatar(req.user.id, { key: null, data: buffer, mime }, res);
    }

    // Set a predefined preset key.
    if (body.preset !== undefined) {
      const preset = String(body.preset).trim();
      if (!PRESET_RE.test(preset)) {
        return res.status(400).json({
          error: 'Preset key must be 1–48 letters, numbers, underscores or hyphens',
        });
      }
      return await setAvatar(req.user.id, { key: preset, data: null, mime: null }, res);
    }

    return res.status(400).json({
      error: 'Send preset (key), data (base64 image) + mime, or remove: true',
    });
  } catch (err) {
    next(err);
  }
});

// Serve the uploaded image so the UI can render <img src="/api/profile/avatar">.
router.get('/avatar', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT avatar_data, avatar_type FROM users WHERE id = $1',
      [req.user.id]
    );
    const row = rows[0];
    if (!row || !row.avatar_data) {
      return res.status(404).json({ error: 'No uploaded avatar' });
    }
    res.setHeader('Content-Type', row.avatar_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(row.avatar_data);
  } catch (err) {
    next(err);
  }
});

router.post('/password', async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    if (!new_password || String(new_password).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const stored = rows[0] && rows[0].password_hash;
    if (!stored || !(await verifyPassword(current_password, stored))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      await hashPassword(new_password),
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
