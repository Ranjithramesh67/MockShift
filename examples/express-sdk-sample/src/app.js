'use strict';

const express = require('express');

const auth = require('./routes/auth');
const users = require('./routes/users');
const orders = require('./routes/orders');

// Two levels of routers on purpose: the SDK composes mount prefixes, so
// GET /api/v1/orders/:orderId/items is registered with its full path.
function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true, service: 'mockshift-sdk-sample' }));

  const v1 = express.Router();
  v1.use('/auth', auth);
  v1.use('/users', users);
  v1.use('/orders', orders);

  const api = express.Router();
  api.use('/v1', v1);
  app.use('/api', api);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

module.exports = { createApp };
