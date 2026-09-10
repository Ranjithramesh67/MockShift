'use strict';

const { resolveFolderPath, foldersFromPaths } = require('./folders');

function normalizeKey(method, path) {
  const m = String(method || '').trim().toUpperCase();
  let p = String(path || '').trim();
  if (p && !p.startsWith('/')) p = `/${p}`;
  return `${m} ${p}`.trim();
}

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '').trim();
  if (!p) return b;
  return `${b}${p.startsWith('/') ? p : `/${p}`}`;
}

function buildManifest(routes, config = {}) {
  const byKey = new Map();
  for (const route of routes || []) {
    const method = String(route.method || '').trim().toUpperCase();
    const path = String(route.path || '').trim();
    if (!method || !path) continue;
    const key = route.key || normalizeKey(method, path);
    const folder = route.folder !== undefined ? route.folder : resolveFolderPath({ ...route, method, path }, config);
    const entry = {
      key,
      name: route.name || key,
      method,
      path,
      url: route.url || joinUrl(config.targetBaseUrl, path),
      apiType: route.apiType || 'REST',
      folder: folder || null,
      headers: route.headers || [],
      queryParams: route.queryParams || [],
      bodyType: route.bodyType || 'NONE',
      bodyJson: route.bodyJson === undefined ? null : route.bodyJson,
      bodyText: route.bodyText === undefined ? null : route.bodyText,
      assertions: route.assertions || [],
      sourceFile: route.sourceFile || null,
    };
    if (byKey.has(key)) {
      byKey.set(key, { ...byKey.get(key), ...entry });
    } else {
      byKey.set(key, entry);
    }
  }
  const requests = [...byKey.values()];
  const folders = foldersFromPaths(requests.map((r) => r.folder).filter(Boolean));
  return {
    source: config.source || 'express',
    project: config.project || null,
    workspace: config.workspace || null,
    collection: config.collection || null,
    targetBaseUrl: config.targetBaseUrl || '',
    prune: Boolean(config.prune),
    folders,
    requests,
  };
}

module.exports = { buildManifest, normalizeKey, joinUrl };
