'use strict';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

function pathMatches(path, config) {
  const p = String(path);
  const include = config.include || [];
  const exclude = config.exclude || [];
  if (include.length && !include.some((prefix) => p.startsWith(prefix))) return false;
  if (exclude.some((prefix) => p.startsWith(prefix))) return false;
  return true;
}

function createExpressAdapter(hub, app, options = {}) {
  if (!app || typeof app !== 'function') {
    throw new TypeError('apihub.express(app): a valid Express app is required');
  }
  if (options.folder !== undefined) hub.config.folder = options.folder;
  if (options.name !== undefined) hub.config.name = options.name;

  for (const method of METHODS) {
    const original = app[method].bind(app);
    app[method] = function patched(path, ...handlers) {
      const isRoute =
        (typeof path === 'string' || Array.isArray(path)) &&
        handlers.some((h) => typeof h === 'function');
      if (isRoute) {
        const paths = Array.isArray(path) ? path : [path];
        for (const p of paths) {
          if (typeof p === 'string' && p.startsWith('/') && pathMatches(p, hub.config)) {
            hub.register({
              method: method === 'all' ? 'ALL' : method.toUpperCase(),
              path: p,
              name: typeof hub.config.name === 'function' ? hub.config.name({ method, path: p }) : undefined,
            });
          }
        }
      }
      return original(path, ...handlers);
    };
  }

  const originalListen = app.listen.bind(app);
  app.listen = function patchedListen(...args) {
    const server = originalListen(...args);
    if (hub.config.autoSync) hub.syncSoon();
    return server;
  };

  return hub;
}

module.exports = { createExpressAdapter, METHODS };
