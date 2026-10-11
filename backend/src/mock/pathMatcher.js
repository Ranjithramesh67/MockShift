'use strict';

/**
 * Minimal mock-route path matcher. A mock route path may contain `:name`
 * segments (e.g. `/users/:id`) which match any single path segment. Returns
 * `{ params }` on match or `null`.
 */
function compileRoutePath(routePath) {
  const cleaned = String(routePath || '/').replace(/\/+$/, '') || '/';
  const segments = cleaned.split('/').filter((s) => s !== '');
  const names = [];
  const pattern = segments
    .map((seg) => {
      if (seg.startsWith(':')) {
        const name = seg.slice(1).trim();
        if (!name) throw new Error('Invalid mock route path: empty param segment');
        names.push(name);
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^/${pattern}$`), names };
}

/**
 * Match a concrete request path against a route path. Returns
 * `{ params }` (an object of captured `:name` values) or null.
 */
function matchRoutePath(routePath, requestPath) {
  let compiled;
  try {
    compiled = compileRoutePath(routePath);
  } catch {
    return null;
  }
  const cleaned = String(requestPath || '/').replace(/\/+$/, '') || '/';
  const m = compiled.regex.exec(cleaned);
  if (!m) return null;
  const params = {};
  compiled.names.forEach((name, i) => {
    params[name] = decodeURIComponent(m[i + 1]);
  });
  return { params };
}

module.exports = { compileRoutePath, matchRoutePath };
