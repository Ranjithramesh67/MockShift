'use strict';

const { resolveFolderPath, foldersFromPaths, clean } = require('./folders');

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

// Fields that carry through to the sync payload. `responseSchema` /
// `requestSchema` are the inferred structures; `formula` and
// `formulaSuggestions` power the editor helpers.
function buildEntry(route, config, key) {
  const method = String(route.method || '').trim().toUpperCase();
  const path = String(route.path || '').trim();
  const folder = route.folder !== undefined
    ? (clean(route.folder) || null)
    : resolveFolderPath({ ...route, method, path }, config);
  return {
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
    source: route.source || null,
    requestSchema: route.requestSchema || null,
    responseSchema: route.responseSchema || null,
    responseType: route.responseType || null,
    statusCode: Number.isFinite(route.statusCode) ? route.statusCode : null,
    formula: route.formula || null,
    formulaSuggestions: route.formulaSuggestions || [],
    sampleCount: route.sampleCount || 0,
    avgDurationMs: Number.isFinite(route.avgDurationMs) ? Math.round(route.avgDurationMs) : null,
  };
}

// Shallow-merge repeated keys; nested structures (schemas/suggestions) prefer
// the newer, more complete value while keeping arrays from the previous entry
// when the new one is empty.
function mergeEntries(prev, next) {
  const merged = { ...prev, ...next };
  if (next.assertions && next.assertions.length === 0 && prev.assertions && prev.assertions.length) {
    merged.assertions = prev.assertions;
  }
  if (!next.responseSchema && prev.responseSchema) merged.responseSchema = prev.responseSchema;
  if (!next.requestSchema && prev.requestSchema) merged.requestSchema = prev.requestSchema;
  if (!next.formula && prev.formula) merged.formula = prev.formula;
  if (next.sampleCount === 0 && prev.sampleCount) merged.sampleCount = prev.sampleCount;
  return merged;
}

function buildManifest(routes, config = {}) {
  const byKey = new Map();
  for (const route of routes || []) {
    const method = String(route.method || '').trim().toUpperCase();
    const path = String(route.path || '').trim();
    if (!method || !path) continue;
    const key = route.key || normalizeKey(method, path);
    const entry = buildEntry({ ...route, method, path }, config, key);
    if (byKey.has(key)) {
      byKey.set(key, mergeEntries(byKey.get(key), entry));
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

module.exports = { buildManifest, buildEntry, mergeEntries, normalizeKey, joinUrl };
