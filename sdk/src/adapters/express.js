'use strict';

const { pathMatches } = require('../match');
const { attachHttp } = require('./capture');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

// Routers created after attach are watched from birth so that a nested mount
// (`api.use('/v1', v1)`) is recorded even when `api` is mounted afterwards.
// Express 5 no longer exposes a layer's mount path, so this is the only way to
// compose nested prefixes in that order.
const HOOK = Symbol.for('mockshift.sdk.routerHook');
const watchers = [];

// Join an Express mount prefix with a route path, mirroring how Express
// composes them ("/api" + "/users" stays "/api/users", never "//users").
function joinPaths(prefix, path) {
  const base = String(prefix || '').replace(/\/+$/, '');
  const p = String(path == null ? '' : path);
  if (!p) return base || '/';
  if (!base) return p.startsWith('/') ? p : `/${p}`;
  const joined = `${base}${p.startsWith('/') ? p : `/${p}`}`;
  // A router's index route is registered as "/", but Express serves it with
  // and without the trailing slash. Record the canonical form only.
  return joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
}

// The stack of an Express app or Router, across versions: routers expose
// `.stack`; apps expose it through `app._router` (v4) or `app.router` (v5).
function stackOf(target) {
  if (!target) return null;
  if (Array.isArray(target.stack)) return target.stack;
  if (target._router && Array.isArray(target._router.stack)) return target._router.stack;
  // Express 5 exposes `app.router` as an own getter. Express 4's `app.router`
  // is a deprecated inherited alias that throws, so never read it.
  const desc = Object.getOwnPropertyDescriptor(target, 'router');
  if (!desc || typeof desc.get !== 'function') return null;
  try {
    const router = desc.get.call(target);
    return router && Array.isArray(router.stack) ? router.stack : null;
  } catch {
    return null;
  }
}

// Recover a mount path from the layer regexp Express 4 keeps. The source is
// built by path-to-regexp, e.g. "^\\/?:lang?\\/?(?=\\/|$)" or
// "^(?:\\/([^/]+?))\\/items\\/?(?=\\/|$)". Rewrite parameter captures as
// ":name" using the layer keys; bail out on constructs we cannot model
// faithfully (alternation) rather than register a wrong path.
function parseMountSource(body, keys, state) {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '\\') {
      out += body[i + 1] || '';
      i += 2;
      continue;
    }
    if (ch === '|') return null;
    if (ch === '(') {
      // Find the matching close paren, accounting for nested groups.
      let depth = 0;
      let end = -1;
      for (let j = i; j < body.length; j++) {
        if (body[j] === '\\') {
          j += 1;
          continue;
        }
        if (body[j] === '(') depth += 1;
        else if (body[j] === ')') {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end < 0) return null;
      const isNonCapturing = body.startsWith('(?:', i);
      const content = body.slice(i + (isNonCapturing ? 3 : 1), end);
      if (isNonCapturing) {
        const nested = parseMountSource(content, keys, state);
        if (nested === null) return null;
        out += nested;
      } else {
        const key = keys[state.index++];
        if (!key) return null;
        out += `:${key.name}`;
      }
      i = end + 1;
      continue;
    }
    if (ch === ')') return null;
    out += ch;
    i += 1;
  }
  return out;
}

function mountPathFromLayer(layer) {
  const source = layer && layer.regexp && layer.regexp.source;
  if (!source) return null;
  const suffix = '\\/?(?=\\/|$)';
  if (!source.startsWith('^') || !source.endsWith(suffix)) return null;
  const path = parseMountSource(source.slice(1, -suffix.length), layer.keys || [], { index: 0 });
  if (!path || !path.startsWith('/')) return null;
  return path;
}

// Flatten app.use('/x', [a, b], c) handler lists.
function flatten(handlers) {
  return handlers.flatMap((h) => (Array.isArray(h) ? flatten(h) : [h]));
}

function mountPathsOf(mount) {
  return Array.isArray(mount) ? mount : [mount];
}

// Wrap `express.Router` once per process so every router created through the
// express module is offered to each attached hub.
function hookRouterFactory() {
  let express;
  try {
    // Optional peer dependency: only present when the Express adapter is used.
    express = require('express');
  } catch {
    return;
  }
  if (!express.Router || express.Router[HOOK]) return;
  const original = express.Router;
  const patched = function router(...args) {
    const instance = original.apply(this, args);
    for (const watch of watchers) {
      try {
        watch(instance);
      } catch {
        // A watcher must never break router creation.
      }
    }
    return instance;
  };
  Object.defineProperty(patched, HOOK, { value: true });
  express.Router = patched;
}

function createExpressAdapter(hub, app, options = {}) {
  if (!app || typeof app !== 'function') {
    throw new TypeError('mockshift.express(app): a valid Express app is required');
  }
  if (options.folder !== undefined) hub.config.folder = options.folder;
  if (options.name !== undefined) hub.config.name = options.name;

  // router -> { prefixes: Set<string>, mounts: Map<router, Set<mountPath>> }
  const nodes = new WeakMap();

  function registerRoute(method, path) {
    if (typeof path !== 'string' || !path.startsWith('/')) return;
    if (!pathMatches(path, hub.config)) return;
    hub.register({
      method: method === '_all' || method === 'all' ? 'ALL' : String(method).toUpperCase(),
      path,
      name: typeof hub.config.name === 'function' ? hub.config.name({ method, path }) : undefined,
    });
  }

  function patchRouter(router, node) {
    for (const method of METHODS) {
      const original = router[method];
      if (typeof original !== 'function') continue;
      router[method] = function patched(path, ...handlers) {
        const isRoute =
          (typeof path === 'string' || Array.isArray(path)) &&
          handlers.some((h) => typeof h === 'function');
        if (isRoute) {
          for (const prefix of node.prefixes) {
            for (const p of mountPathsOf(path)) registerRoute(method, joinPaths(prefix, p));
          }
        }
        return original.call(router, path, ...handlers);
      };
    }

    const originalUse = router.use;
    if (typeof originalUse === 'function') {
      router.use = function patchedUse(mount, ...handlers) {
        let mountPath = '';
        let rest = handlers;
        if (typeof mount === 'string' || Array.isArray(mount)) mountPath = mount;
        else rest = [mount, ...handlers];
        for (const handler of flatten(rest)) {
          if (typeof handler !== 'function' || !stackOf(handler)) continue;
          for (const m of mountPathsOf(mountPath)) {
            const mounts = node.mounts.get(handler) || new Set();
            mounts.add(m);
            node.mounts.set(handler, mounts);
            for (const prefix of node.prefixes) attach(handler, joinPaths(prefix, m));
          }
        }
        return originalUse.call(router, mount, ...handlers);
      };
    }
  }

  function watch(router) {
    let node = nodes.get(router);
    if (!node) {
      node = { prefixes: new Set(), mounts: new Map() };
      nodes.set(router, node);
      patchRouter(router, node);
    }
    return node;
  }

  function attach(router, prefix, depth = 0) {
    if (depth > 20) return;
    const node = watch(router);
    if (node.prefixes.has(prefix)) return;
    node.prefixes.add(prefix);

    const stack = stackOf(router);
    for (const layer of stack || []) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {});
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) {
          if (typeof path !== 'string') continue;
          for (const method of methods) registerRoute(method, joinPaths(prefix, path));
        }
        continue;
      }
      if (!layer.handle || !stackOf(layer.handle)) continue;
      const mount = mountPathFromLayer(layer);
      if (mount === null) continue;
      const mounts = node.mounts.get(layer.handle) || new Set();
      mounts.add(mount);
      node.mounts.set(layer.handle, mounts);
      attach(layer.handle, joinPaths(prefix, mount), depth + 1);
    }

    // Replay mounts recorded by the factory/use hook (Express 5 pre-mounts).
    for (const [child, mounts] of node.mounts) {
      for (const m of mounts) attach(child, joinPaths(prefix, m), depth + 1);
    }
  }

  watchers.push(watch);
  hookRouterFactory();
  attach(app, '');

  const originalListen = app.listen.bind(app);
  app.listen = function patchedListen(...args) {
    const server = originalListen(...args);
    if (hub.config.capture && hub.config.capture.enabled) attachHttp(hub, server, { autoSync: false });
    if (hub.config.autoSync) hub.syncSoon();
    return server;
  };

  return hub;
}

module.exports = { createExpressAdapter, METHODS, mountPathFromLayer, joinPaths };
