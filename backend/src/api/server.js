'use strict';

const express = require('express');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const workspaceRoutes = require('./routes/workspaces');
const environmentRoutes = require('./routes/environments');
const teamRoutes = require('./routes/teams');
const contentRoutes = require('./routes/content');
const manageRoutes = require('./routes/manage');
const projectRoutes = require('./routes/projects');
const workflowRoutes = require('./routes/workflows');
const automationRoutes = require('./routes/automations').router;
const notificationRoutes = require('./routes/notifications');
const historyRoutes = require('./routes/history');
const mockServerRoutes = require('./routes/mockServers');
const exportRoutes = require('./routes/exports');
const { mockDispatch } = require('./mockDispatch');
const { query } = require('./db');
const { runWorkflow, syncAllSchedules } = require('./workflowService');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'apihub-api' });
  });

  // Public webhook trigger for WEBHOOK automations (no auth by design).
  // Registered before the authenticated /api routers so requireAuth does not
  // intercept it.
  app.post('/api/webhooks/:token', async (req, res, next) => {
    try {
      const { token } = req.params;
      const { rows } = await query(
        `SELECT id, workflow_id, enabled, input_vars FROM automations
          WHERE webhook_token = $1 AND trigger_type = 'WEBHOOK'`,
        [token]
      );
      const automation = rows[0];
      if (!automation || !automation.enabled) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      const inputVars =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? { ...(automation.input_vars || {}), ...req.body }
          : automation.input_vars || {};
      const runId = await runWorkflow({
        workflowId: automation.workflow_id,
        trigger: 'WEBHOOK',
        inputVars,
      });
      res.status(202).json({ ok: true, runId });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/manage', manageRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api', environmentRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api', contentRoutes);
  app.use('/api', projectRoutes);
  app.use('/api', workflowRoutes);
  app.use('/api', automationRoutes);
  app.use('/api', notificationRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api', mockServerRoutes);
  app.use('/api', exportRoutes);

  // Public per-project mock server: hit it like any external API.
  // Registered before the /api 404 handler (different prefix) so requests to
  // http://127.0.0.1:3001/mock/:projectId/... are served with no auth.
  app.use('/mock/:projectId', mockDispatch);

  // 404 for unknown API routes.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // Central error handler.
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error('[api] error', err);
    }
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

function startServer({ port = Number(process.env.PORT || 3001) } = {}) {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`[api] listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

module.exports = { createApp, startServer, syncAllSchedules };

if (require.main === module) {
  startServer();
  // Re-register persisted cron schedules after a restart.
  setTimeout(() => {
    syncAllSchedules().then((n) => {
      // eslint-disable-next-line no-console
      console.log(`[api] synced ${n} scheduled automations`);
    });
  }, 2000);
}
