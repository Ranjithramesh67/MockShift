'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, requireAdmin } = require('../access');

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, role, is_active, created_at
         FROM users ORDER BY created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role, isActive } = req.body || {};

    const target = await query(`SELECT role FROM users WHERE id = $1`, [userId]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    if (role !== undefined) {
      if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      if (userId === req.user.id && role !== 'ADMIN') {
        return res.status(400).json({ error: 'You cannot demote yourself' });
      }
      await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, userId]);
    }

    if (isActive !== undefined) {
      if (userId === req.user.id && isActive === false) {
        return res.status(400).json({ error: 'You cannot deactivate yourself' });
      }
      // Never deactivate the last active admin.
      if (isActive === false && target.rows[0].role === 'ADMIN') {
        const admins = await query(
          `SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND is_active = true`
        );
        if (admins.rows[0].n <= 1) {
          return res.status(400).json({ error: 'Cannot deactivate the last admin' });
        }
      }
      await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive === true, userId]);
    }

    const updated = await query(
      `SELECT id, email, name, role, is_active, created_at FROM users WHERE id = $1`,
      [userId]
    );
    res.json({ user: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
