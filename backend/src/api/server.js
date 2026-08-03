'use strict';

const express = require('express');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const workspaceRoutes = require('./routes/workspaces');
const teamRoutes = require('./routes/teams');
const contentRoutes = require('./routes/content');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'apihub-api' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api', contentRoutes);

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

module.exports = { createApp, startServer };

if (require.main === module) {
  startServer();
}
