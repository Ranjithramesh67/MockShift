'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');

const router = Router();
router.use(requireAuth);

router.get('/notifications', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await query(
      `SELECT id, title, body, kind, read, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ notifications: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/:notificationId/read', async (req, res, next) => {
  try {
    await query(
      `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`,
      [req.params.notificationId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/read-all', async (req, res, next) => {
  try {
    await query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
