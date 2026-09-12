'use strict';

function ensureLeadingSlash(path) {
  const value = String(path == null ? '' : path).trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * Express-style route paths use `:name` segments; the repository's request
 * runner substitutes `{{name}}` from variables, so convert on insert.
 */
function pathToRequestPath(routePath) {
  return ensureLeadingSlash(routePath).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{{$1}}');
}

function mockRouteUrl(baseUrl, routePath) {
  return `${trimTrailingSlashes(baseUrl)}${pathToRequestPath(routePath)}`;
}

function filterMockRoutes(routes, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return routes;
  return routes.filter((route) => `${route.method} ${route.path}`.toLowerCase().includes(q));
}

module.exports = { ensureLeadingSlash, pathToRequestPath, mockRouteUrl, filterMockRoutes };
