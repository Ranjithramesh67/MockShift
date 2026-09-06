'use strict';

const express = require('express');
const { query, access, authRouter } = require('./shared');
const { roleAtLeast } = require('./portalAccess');
const publicCatalogRouter = require('./routes/publicCatalog');
const plansRouter = require('./routes/plans');
const summaryRouter = require('./routes/summary');
const dashboardRouter = require('./routes/dashboard');
const subscribersRouter = require('./routes/subscribers');
const promoCodesRouter = require('./routes/promoCodes');
const auditRouter = require('./routes/audit');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'apihub-portal-api' });
  });

  // Auth reuses the repo session scheme (same users table + cookie signature).
  app.use('/api/auth', authRouter);

  // Authenticated session identity for the portal.
  app.get('/api/me', access.requireAuth, async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT id, email, name, role, is_active, created_at FROM users WHERE id = $1`,
        [req.user.id]
      );
      const user = rows[0];
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      res.json({
        user,
        portalRole: roleAtLeast(user.role, 'VIEWER') ? user.role : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // Portal A — public showcase/catalog endpoints (no auth).
  app.use('/api/public', publicCatalogRouter);

  // Portal B — internal management endpoints behind RBAC.
  app.use('/api/plans', plansRouter);
  app.use('/api/portal', summaryRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/subscribers', subscribersRouter);
  app.use('/api/promo-codes', promoCodesRouter);
  app.use('/api/audit', auditRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error('[portal-api] error', err);
    }
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

function startServer({ port = Number(process.env.PORT || 3102) } = {}) {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`[portal-api] listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

module.exports = { createApp, startServer };

if (require.main === module) {
  startServer();
}
