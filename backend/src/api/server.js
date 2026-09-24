'use strict';

const express = require('express');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');
const workspaceRoutes = require('./routes/workspaces');
const environmentRoutes = require('./routes/environments');
const teamRoutes = require('./routes/teams');
const contentRoutes = require('./routes/content');
const manageRoutes = require('./routes/manage');
const projectRoutes = require('./routes/projects');
const iamRoutes = require('./routes/iam');
const workflowRoutes = require('./routes/workflows');
const automationRoutes = require('./routes/automations').router;
const notificationRoutes = require('./routes/notifications');
const eventsRoutes = require('./routes/events');
const historyRoutes = require('./routes/history');
const mockServerRoutes = require('./routes/mockServers');
const exportRoutes = require('./routes/exports');
const shareRoutes = require('./routes/shares');
const tokenRoutes = require('./routes/tokens');
const serverRunRoutes = require('./routes/serverRuns');
const sendRoutes = require('./routes/sends');
const docsRoutes = require('./routes/docs');
const contractsRoutes = require('./routes/contracts');
const monitorRoutes = require('./routes/monitors');
const mockScenarioRoutes = require('./routes/mockScenarios');
const copilotRoutes = require('./routes/copilot');
const commentRoutes = require('./routes/comments');
const reviewRoutes = require('./routes/reviews');
const versionRoutes = require('./routes/versions');
const requestRevisionRoutes = require('./routes/requestRevisions');
const sdkRoutes = require('./routes/sdk');
const menuAccessRoutes = require('./routes/menuAccess');
const searchRoutes = require('./routes/search');
const userLlmRoutes = require('./routes/userLlm');
const jsonComparisonRoutes = require('./routes/jsonComparisons');
const networkRoutes = require('./routes/network');
const { requireMenuEnabled } = require('./menuAccess');
const { mockDispatch } = require('./mockDispatch');
const { query } = require('./db');
const { runWorkflow, syncAllSchedules } = require('./workflowService');

// Postgres "class 22" data-exception / constraint codes that mean the caller
// sent something malformed (bad uuid, bad number, wrong type, over-length).
// Mapped to a 400 by the central error handler instead of a raw 500.
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
  // 25 MB cap: multipart file sends carry base64 file bytes inside the JSON
  // run payload (the runner reconstructs a real multipart body upstream).
  app.use(express.json({ limit: '25mb' }));

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

  // Public doc-share viewer (no auth by design): registered before the
  // authenticated /api routers so requireAuth does not intercept it.
  app.use('/api/docs/public', docsRoutes.publicRouter);

  app.use('/api/auth', authRoutes);
  // Effective feature flags for the current user (rail + route guards).
  app.use('/api/menu-access', menuAccessRoutes);
  app.use('/api/profile/llm', userLlmRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api', shareRoutes);
  app.use('/api/admin', adminRoutes);
  // Feature gates: a disabled menu must reject direct API access. Each gate runs
  // before the router that serves its prefix; the gate authenticates the request
  // itself, so the router's own requireAuth is a cheap no-op (see access.js).
  app.use('/api/manage', requireMenuEnabled('manage'), manageRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api', environmentRoutes);
  app.use('/api/teams', requireMenuEnabled('teams'), teamRoutes);
  app.use('/api', serverRunRoutes);
  app.use('/api', contentRoutes);
  app.use('/api/tokens', tokenRoutes);
  app.use('/api', sendRoutes);
  app.use('/api', projectRoutes);
  app.use('/api', iamRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api', workflowRoutes);
  app.use('/api/automations', requireMenuEnabled('automations'));
  app.use('/api', automationRoutes);
  app.use('/api', notificationRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/history', requireMenuEnabled('history'), historyRoutes);
  app.use('/api/json-comparisons', requireMenuEnabled('json-compare'), jsonComparisonRoutes);
  app.use('/api/network', requireMenuEnabled('network'), networkRoutes);
  app.use('/api', mockServerRoutes);
  app.use('/api', exportRoutes);
  app.use('/api/docs', requireMenuEnabled('docs'), docsRoutes);
  app.use('/api/contracts', requireMenuEnabled('contracts'), contractsRoutes);
  app.use('/api/monitors', requireMenuEnabled('monitors'), monitorRoutes);
  app.use('/api/copilot', requireMenuEnabled('copilot'), copilotRoutes);
  app.use('/api/mock-scenarios', requireMenuEnabled('mock-scenarios'));
  app.use('/api/mock-routes', requireMenuEnabled('mock-scenarios'));
  app.use('/api', mockScenarioRoutes);
  app.use('/api/comments', requireMenuEnabled('collab'));
  app.use('/api/reviews', requireMenuEnabled('collab'));
  app.use('/api', commentRoutes);
  app.use('/api', reviewRoutes);
  app.use('/api', versionRoutes);
  app.use('/api', requestRevisionRoutes);
  app.use('/api/sdk', sdkRoutes);

  // Public per-project mock server: hit it like any external API.
  // The scenario middleware runs first so scenario/conditional responses and
  // call logging apply, falling through to the base mock dispatch.
  // Registered before the /api 404 handler (different prefix) so requests to
  // http://127.0.0.1:3001/mock/:projectId/... are served with no auth.
  app.use('/mock/:projectId', mockScenarioRoutes.createMockScenarioMiddleware());
  app.use('/mock/:projectId', mockDispatch);

  // 404 for unknown API routes.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // Central error handler. Client errors (4xx) surface their message; anything
  // unexpected becomes a generic 500 so DB internals never leak. Postgres
  // invalid-input codes are mapped to 400 (e.g. a malformed uuid in a path).
  app.use((err, req, res, next) => {
    const badInput = PG_INVALID_INPUT_CODES.has(err.code);
    const status = err.status || (badInput ? 400 : 500);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error('[api] error', err);
    }
    // Route-level 4xx errors carry a purposeful message; malformed-input errors
    // straight from Postgres are replaced with a generic one so schema details
    // never reach the client.
    const message = err.status
      ? err.message || 'Request failed'
      : badInput
        ? 'Invalid request'
        : 'Internal server error';
    res.status(status).json({ error: message });
  });

  return app;
}

function startServer({ port = Number(process.env.PORT || 3001), host = process.env.HOST } = {}) {
  const app = createApp();
  return new Promise((resolve) => {
    // When HOST is unset Node keeps its default (all interfaces). Deployments
    // that sit behind a reverse proxy should set HOST=127.0.0.1 so the API is
    // only reachable through the proxy, never directly over plaintext.
    const onListen = () => {
      // eslint-disable-next-line no-console
      console.log(`[api] listening on http://${host || '0.0.0.0'}:${port}`);
      resolve(server);
    };
    const server = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
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
  // Run-history retention purge (interval-based, first tick shortly after boot).
  const { startRetentionScheduler } = require('./retention');
  startRetentionScheduler();
  // Monitored API checks (E2): own interval scheduler, first tick after boot.
  const { startMonitorScheduler } = require('./monitorRunner');
  startMonitorScheduler();
}
