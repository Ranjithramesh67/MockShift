'use strict';

const express = require('express');
const { query, access, authRouter } = require('./shared');
const { roleAtLeast } = require('./portalAccess');
const publicCatalogRouter = require('./routes/publicCatalog');
const publicCheckoutRouter = require('./routes/publicCheckout');
const customerAccountRouter = require('./routes/customerAccount');
const plansRouter = require('./routes/plans');
const summaryRouter = require('./routes/summary');
const dashboardRouter = require('./routes/dashboard');
const subscribersRouter = require('./routes/subscribers');
const promoCodesRouter = require('./routes/promoCodes');
const auditRouter = require('./routes/audit');
const settingsRouter = require('./routes/settings');
const companyDomainsRouter = require('./routes/companyDomains');
const paymentGatewayRouter = require('./routes/paymentGateway');
const webhooksRouter = require('./routes/webhooks');

// Postgres data-exception / invalid-input codes -> 400 instead of a raw 500.
const PG_INVALID_INPUT_CODES = new Set([
  '22P02',
  '22007',
  '22008',
  '22003',
  '22001',
  '2201W',
  '23502',
  '23514',
]);

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
  app.use('/api/public', publicCheckoutRouter);
  // Portal A — simulated payment gateway + provider webhooks (A6).
  app.use('/api/public/gateway', paymentGatewayRouter);
  app.use('/api/public/webhooks', webhooksRouter);
  // Portal A — subscriber self-service (session auth, own data only).
  app.use('/api/public/account', customerAccountRouter);

  // Portal B — internal management endpoints behind RBAC.
  app.use('/api/plans', plansRouter);
  app.use('/api/portal', summaryRouter);
  app.use('/api/portal', settingsRouter);
  app.use('/api/portal', companyDomainsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/subscribers', subscribersRouter);
  app.use('/api/promo-codes', promoCodesRouter);
  app.use('/api/audit', auditRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  app.use((err, req, res, next) => {
    const badInput = PG_INVALID_INPUT_CODES.has(err.code);
    const status = err.status || (badInput ? 400 : 500);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error('[portal-api] error', err);
    }
    const message = err.status
      ? err.message || 'Request failed'
      : badInput
        ? 'Invalid request'
        : 'Internal server error';
    res.status(status).json({ error: message });
  });

  return app;
}

function startServer({ port = Number(process.env.PORT || 3102), host = process.env.HOST } = {}) {
  const app = createApp();
  return new Promise((resolve) => {
    // When HOST is unset Node keeps its default (all interfaces). Deployments
    // that sit behind a reverse proxy should set HOST=127.0.0.1 so the API is
    // only reachable through the proxy, never directly over plaintext.
    const onListen = () => {
      // eslint-disable-next-line no-console
      console.log(`[portal-api] listening on http://${host || '0.0.0.0'}:${port}`);
      resolve(server);
    };
    const server = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
  });
}

module.exports = { createApp, startServer };

if (require.main === module) {
  startServer();
}
