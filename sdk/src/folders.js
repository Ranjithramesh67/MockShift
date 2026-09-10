'use strict';

function titleCase(segment) {
  const s = String(segment || '').replace(/^:/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Root';
}

function defaultFolder(route) {
  const first = String(route.path || '/').split('/').filter(Boolean)[0];
  return first ? titleCase(first) : 'Root';
}

function structureFolder(route, structure) {
  const path = String(route.path || '/');
  let best = null;
  for (const prefix of Object.keys(structure || {})) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best.length) best = prefix;
    }
  }
  return best ? String(structure[best]) : null;
}

function clean(path) {
  return String(path || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(titleCase)
    .join('/');
}

// Resolve the slash-separated nested folder path for a route.
function resolveFolderPath(route, config = {}) {
  if (typeof config.folder === 'function') return clean(config.folder(route));
  if (typeof config.folder === 'string' && config.folder.trim()) return clean(config.folder);
  if (config.structure && typeof config.structure === 'object') {
    const match = structureFolder(route, config.structure);
    if (match) return clean(match);
  }
  return clean(defaultFolder(route));
}

// Expand a set of folder paths into {key,name,parent} entries (parents first).
function foldersFromPaths(paths) {
  const entries = new Map();
  for (const raw of paths) {
    const segments = clean(raw).split('/').filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const key = segments.slice(0, i + 1).join('/');
      if (entries.has(key)) continue;
      entries.set(key, {
        key,
        name: segments[i],
        parent: i === 0 ? null : segments.slice(0, i).join('/'),
      });
    }
  }
  return [...entries.values()];
}

module.exports = { resolveFolderPath, foldersFromPaths, titleCase, clean };
