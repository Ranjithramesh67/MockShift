'use strict';

const { createConfig } = require('./config');
const { createClient } = require('./client');
const { buildManifest } = require('./manifest');
const { normalizeExpects } = require('./assertions');
const { ApiHubError, ApiHubConfigError } = require('./errors');

class ApiHub {
  constructor(options = {}) {
    this.config = createConfig(options);
    this.client = createClient(this.config);
    this.routes = [];
    this._synced = false;
  }

  register(route) {
    if (!route || !route.method || !route.path) {
      throw new ApiHubConfigError('register() requires { method, path }');
    }
    const method = String(route.method).toUpperCase();
    const path = String(route.path);
    const index = this.routes.findIndex((r) => r.method === method && r.path === path);
    const next = { ...route, method, path };
    if (index >= 0) this.routes[index] = { ...this.routes[index], ...next };
    else this.routes.push(next);
    return this;
  }

  test(key, expects) {
    const route = this.routes.find((r) => (r.key || `${r.method} ${r.path}`) === key);
    if (!route) {
      throw new ApiHubConfigError(`apihub.test: unknown route "${key}" — register the route before calling test()`);
    }
    route.assertions = normalizeExpects(expects);
    return this;
  }

  manifest() {
    return buildManifest(this.routes, this.config);
  }

  async sync() {
    const result = await this.client.sync(this.manifest());
    this._synced = true;
    return result;
  }

  // Non-blocking: never rejects; routes errors to config.onError when provided.
  syncSoon() {
    setImmediate(() => {
      this.sync().catch((err) => {
        if (typeof this.config.onError === 'function') this.config.onError(err);
      });
    });
    return this;
  }

  express(app, options = {}) {
    const { createExpressAdapter } = require('./adapters/express');
    return createExpressAdapter(this, app, options);
  }
}

function createHub(options = {}) {
  return new ApiHub(options);
}

function attach(app, options = {}) {
  const hub = new ApiHub(options);
  hub.express(app, options);
  return hub;
}

module.exports = { ApiHub, createHub, attach, ApiHubError, ApiHubConfigError };
