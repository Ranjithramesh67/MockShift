'use strict';

// Pure helpers for POST /api/sdk/sync. No DB, no network — unit-testable.

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function normalizeKey(method, path) {
  const m = String(method || '').trim().toUpperCase();
  let p = String(path || '').trim();
  if (p && !p.startsWith('/')) p = `/${p}`;
  return `${m} ${p}`.trim();
}

function joinUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const p = String(path || '').trim();
  if (!p) return b;
  const withSlash = p.startsWith('/') ? p : `/${p}`;
  return `${b}${withSlash}`;
}

function pickUniqueName(desired, usedNames) {
  const base = String(desired || '').trim() || 'Untitled';
  const taken = new Set(usedNames.map((n) => String(n).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const copy = `${base} (copy)`;
  if (!taken.has(copy.toLowerCase())) return copy;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${copy} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${copy} ${Date.now()}`;
}

// Order folders parents-first (stable), assign depth, and validate parent
// references + cycles.
function nestFolders(folders) {
  const list = (folders || []).map((f) => ({
    key: String(f.key || '').trim(),
    name: String(f.name || f.key || '').trim(),
    parent: f.parent ? String(f.parent).trim() : null,
  }));
  const byKey = new Map(list.map((f) => [f.key, f]));
  for (const f of list) {
    if (!f.key) throw new Error('folder key is required');
    if (f.parent && !byKey.has(f.parent)) {
      throw new Error(`folder "${f.key}" references unknown parent "${f.parent}"`);
    }
  }
  const out = [];
  const state = new Map(); // key -> 'visiting' | 'done'
  const visit = (folder, depth, stack) => {
    if (state.get(folder.key) === 'done') return;
    if (state.get(folder.key) === 'visiting') {
      throw new Error(`folder cycle detected at "${folder.key}" (${stack.join(' -> ')})`);
    }
    state.set(folder.key, 'visiting');
    if (folder.parent) visit(byKey.get(folder.parent), depth - 1, [...stack, folder.key]);
    out.push({ ...folder, depth });
    state.set(folder.key, 'done');
  };
  for (const f of list) visit(f, 0, [f.key]);
  // Recompute real depth from resolved parent chain (visit pushed bottom-up).
  const depthOf = (key) => {
    let d = 0;
    let cur = byKey.get(key);
    const seen = new Set();
    while (cur && cur.parent && !seen.has(cur.key)) {
      seen.add(cur.key);
      d += 1;
      cur = byKey.get(cur.parent);
    }
    return d;
  };
  out.sort((a, b) => depthOf(a.key) - depthOf(b.key));
  return out.map((f) => ({
    key: f.key,
    name: f.name,
    parent: f.parent,
    depth: depthOf(f.key),
  }));
}

function normalizeRequest(raw, baseUrl, defaultSource) {
  if (!raw || typeof raw !== 'object') throw new Error('each request must be an object');
  const method = String(raw.method || '').trim().toUpperCase();
  const path = String(raw.path || '').trim();
  if (!method || !path) throw new Error(`request "${raw.key || '(unknown)'}" requires method and path`);
  if (!HTTP_METHODS.has(method)) throw new Error(`request "${path}" has invalid method "${method}"`);
  const key = raw.key ? String(raw.key).trim() : normalizeKey(method, path);
  return {
    key,
    name: String(raw.name || key).trim(),
    method,
    path,
    url: raw.url ? String(raw.url).trim() : joinUrl(baseUrl, path),
    apiType: raw.apiType || 'REST',
    folder: raw.folder ? String(raw.folder).trim() : null,
    headers: Array.isArray(raw.headers) ? raw.headers : [],
    queryParams: Array.isArray(raw.queryParams) ? raw.queryParams : [],
    bodyType: raw.bodyType || 'NONE',
    bodyJson: raw.bodyJson === undefined ? null : raw.bodyJson,
    bodyText: raw.bodyText === undefined ? null : raw.bodyText,
    assertions: Array.isArray(raw.assertions) ? raw.assertions : [],
    sourceFile: raw.sourceFile ? String(raw.sourceFile) : null,
    source: raw.source || defaultSource || null,
  };
}

function normalizeManifest(body) {
  const input = body || {};
  if (input.folders !== undefined && !Array.isArray(input.folders)) {
    throw new Error('folders must be an array');
  }
  if (input.requests !== undefined && !Array.isArray(input.requests)) {
    throw new Error('requests must be an array');
  }
  const source = input.source ? String(input.source).trim() : 'sdk';
  const targetBaseUrl = input.targetBaseUrl ? String(input.targetBaseUrl).trim() : '';
  const requests = (input.requests || []).map((r) => normalizeRequest(r, targetBaseUrl, source));
  const folders = nestFolders(input.folders || []);
  return {
    source,
    project: input.project ? String(input.project).trim() : null,
    workspace: input.workspace ? String(input.workspace).trim() : null,
    collection: input.collection ? String(input.collection).trim() : null,
    projectId: input.projectId || null,
    workspaceId: input.workspaceId || null,
    targetBaseUrl,
    prune: Boolean(input.prune),
    folders,
    requests,
  };
}

module.exports = {
  HTTP_METHODS,
  normalizeKey,
  joinUrl,
  pickUniqueName,
  nestFolders,
  normalizeRequest,
  normalizeManifest,
};
