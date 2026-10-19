'use strict';

const { attach } = require('mockshift-sdk');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 4100);
const app = createApp();

const hub = attach(app, {
  apiKey: process.env.MOCKSHIFT_API_KEY,
  baseUrl: process.env.MOCKSHIFT_BASE_URL,
  project: process.env.MOCKSHIFT_PROJECT,
  collection: process.env.MOCKSHIFT_COLLECTION,
  targetBaseUrl: process.env.SAMPLE_BASE_URL || `http://127.0.0.1:${port}`,
  source: 'express-sample',
  include: ['/api', '/health'],
  exclude: [],
  // A remote Mockshift instance with a managed database can take several
  // seconds to upsert a collection of requests; the SDK default (5s) is tuned
  // for local development.
  timeoutMs: Number(process.env.MOCKSHIFT_TIMEOUT_MS || 30000),
  autoSync: true,
  onError: (err) => console.error('[mockshift] sync failed:', err.message),
});

app.listen(port, '127.0.0.1', () => {
  const routes = hub.manifest().requests.map((r) => r.key);
  console.log(`[sample] listening on http://127.0.0.1:${port}`);
  console.log(`[sample] ${routes.length} routes discovered:`);
  for (const key of routes) console.log(`  ${key}`);
});
