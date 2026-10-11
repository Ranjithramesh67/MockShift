'use strict';

const { createConfig } = require('./config');
const { createClient } = require('./client');
const { buildManifest } = require('./manifest');
const { normalizeExpects } = require('./assertions');
const {
  inferSchema,
  mergeSchema,
  suggestAssertions,
  suggestFormulas,
  summarizeSample,
} = require('./infer');
const { MockshiftError, MockshiftConfigError, ApiHubError, ApiHubConfigError } = require('./errors');

class Mockshift {
  constructor(options = {}) {
    this.config = createConfig(options);
    this.client = createClient(this.config);
    this.routes = [];
    this._synced = false;
  }

  register(route) {
    if (!route || !route.method || !route.path) {
      throw new MockshiftConfigError('register() requires { method, path }');
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
      throw new MockshiftConfigError(`mockshift.test: unknown route "${key}" — register the route before calling test()`);
    }
    route.assertions = normalizeExpects(expects);
    route._autoAssertions = false;
    return this;
  }

  // Fold a single observed request/response into the route table. Called by
  // the runtime capture adapters; exported for manual instrumentation.
  record(observation) {
    if (!observation || !observation.method || !(observation.template || observation.path)) return this;
    const method = String(observation.method).toUpperCase();
    const path = String(observation.template || observation.path);
    let route = this.routes.find((r) => r.method === method && r.path === path);
    if (!route) {
      route = { method, path, apiType: observation.apiType || 'REST', source: 'runtime' };
      this.routes.push(route);
    }

    route.apiType = observation.apiType || route.apiType || 'REST';
    route.responseType = observation.responseType || route.responseType || null;
    if (Number.isFinite(observation.status)) route.statusCode = observation.status;
    route.sampleCount = (route.sampleCount || 0) + 1;
    const n = route.sampleCount;
    if (Number.isFinite(observation.durationMs)) {
      const prev = Number.isFinite(route.avgDurationMs) ? route.avgDurationMs : observation.durationMs;
      route.avgDurationMs = prev + (observation.durationMs - prev) / n;
    }
    route.lastSeen = new Date().toISOString();

    if (observation.requestBody && typeof observation.requestBody === 'object') {
      route.bodyType = 'JSON';
      route.bodyJson = observation.requestBody;
      route.requestSchema = mergeSchema(route.requestSchema, inferSchema(observation.requestBody));
    } else if (typeof observation.requestBody === 'string' && observation.requestBody) {
      if (!route.bodyType || route.bodyType === 'NONE') route.bodyType = 'TEXT';
      route.bodyText = observation.requestBody;
    }

    if (observation.responseBody && typeof observation.responseBody === 'object') {
      route.responseSchema = mergeSchema(route.responseSchema, inferSchema(observation.responseBody));
      route.responseSample = summarizeSample(observation.responseBody);
    }

    const assertionsOpt = this.config.assertions || {};
    const auto = assertionsOpt.suggest !== false;
    if (auto && (!route.assertions || route.assertions.length === 0 || route._autoAssertions)) {
      route.assertions = suggestAssertions(
        { ...observation, durationMs: route.avgDurationMs },
        this.config
      );
      route._autoAssertions = true;
    }

    if (!route.formulaSuggestions || route.formulaSuggestions.length === 0) {
      route.formulaSuggestions = suggestFormulas(route, this.config);
    }
    return this;
  }

  // The manifest that will be sent on sync (also handy for debugging/tests).
  inspect() {
    return this.manifest();
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

  // Attach runtime capture to a plain http.Server (or an Express app).
  http(server) {
    const { attachHttp } = require('./adapters/capture');
    return attachHttp(this, server);
  }

  // Express middleware that captures traffic without patching app.listen.
  middleware() {
    const { middleware } = require('./adapters/capture');
    return middleware(this);
  }
}

function createHub(options = {}) {
  return new Mockshift(options);
}

// Attach to a Node http.Server without the Express adapter.
function attachHttp(server, options = {}) {
  const hub = options.hub instanceof Mockshift ? options.hub : new Mockshift(options);
  hub.http(server);
  return hub;
}

function attach(app, options = {}) {
  const hub = options.hub instanceof Mockshift ? options.hub : new Mockshift(options);
  hub.express(app, options);
  return hub;
}

module.exports = {
  Mockshift,
  ApiHub: Mockshift,
  createHub,
  attach,
  attachHttp,
  MockshiftError,
  MockshiftConfigError,
  ApiHubError,
  ApiHubConfigError,
};
