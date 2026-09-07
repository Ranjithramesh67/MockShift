'use strict';

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');
const { logAudit } = require('../auditLog');

const router = Router();

// Portal B — global restrictions settings (L1). Single portal_settings row
// (migration 019): `restrictions_enforced` is the master switch that
// short-circuits every per-plan usage gate when OFF.
//
//   GET /api/portal/settings   VIEWER+
//   PUT /api/portal/settings   MANAGER+  body { restrictions_enforced: bool }
router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT restrictions_enforced, updated_by, updated_at
         FROM portal_settings ORDER BY id LIMIT 1`,
      [],
      { userId: req.user.id }
    );
    res.json({ settings: rows[0] || { restrictions_enforced: true } });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (typeof body.restrictions_enforced !== 'boolean') {
      return res.status(400).json({ error: 'restrictions_enforced must be a boolean' });
    }
    const { rows } = await query(
      `INSERT INTO portal_settings (id, restrictions_enforced, updated_by, updated_at)
       VALUES (true, $1, $2, now())
       ON CONFLICT (id) DO UPDATE
         SET restrictions_enforced = EXCLUDED.restrictions_enforced,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
       RETURNING restrictions_enforced, updated_by, updated_at`,
      [body.restrictions_enforced, req.user.id],
      { userId: req.user.id }
    );
    const settings = rows[0];
    await logAudit(req, {
      action: 'settings.update',
      targetType: 'settings',
      targetId: 'portal',
      targetRef: 'portal_settings',
      before: null,
      after: { restrictions_enforced: settings.restrictions_enforced },
    });
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
