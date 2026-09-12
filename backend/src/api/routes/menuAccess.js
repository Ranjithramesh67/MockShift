'use strict';

// ============================================================================
// Effective menu flags for the current user — mounted at /api/menu-access.
//
//   GET /api/menu-access?workspaceId=&projectId=
//     -> { menus: { key: boolean }, projectId, orgId, keys }
//
// The frontend rail and route guards read this so they match the backend
// requireMenuEnabled() gate. `projectId` (when known) makes project-scoped
// overrides apply; otherwise the workspace's organization (or the user's
// primary org) is used.
// ============================================================================

const { Router } = require('express');
const { requireAuth } = require('../access');
const { effectiveMenus, MENU_KEYS } = require('../menuAccess');

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : null;
    const result = await effectiveMenus({ userId: req.user.id, projectId, workspaceId });
    res.json({ menus: result.menus, projectId: result.projectId, orgId: result.orgId, keys: MENU_KEYS });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
