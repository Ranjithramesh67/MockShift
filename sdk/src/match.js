'use strict';

// Shared include/exclude matcher for a concrete request path.
// include: when non-empty, the path must start with one of the prefixes.
// exclude: any matching prefix removes the path, even if included.
function pathMatches(pathname, config = {}) {
  const p = String(pathname || '/');
  const include = config.include || [];
  const exclude = config.exclude || [];
  if (include.length && !include.some((prefix) => p === prefix || p.startsWith(prefix))) return false;
  if (exclude.some((prefix) => p === prefix || p.startsWith(prefix))) return false;
  return true;
}

module.exports = { pathMatches };
