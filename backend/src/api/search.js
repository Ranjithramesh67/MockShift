'use strict';

const TYPE_MENU = {
  workspace: 'apis',
  project: 'apis',
  collection: 'apis',
  folder: 'apis',
  request: 'apis',
  workflow: 'apis',
  doc: 'docs',
  contract: 'contracts',
  monitor: 'monitors',
  mockScenario: 'mock-scenarios',
};

function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

function normalizeQuery(raw, limit) {
  const q = String(raw == null ? '' : raw).trim();
  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 20;
  return { q, limit: capped, ok: q.length > 0 };
}

function rankResult(result, q) {
  const needle = String(q).toLowerCase();
  const name = String((result && (result.name || result.title)) || '').toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  const idx = name.indexOf(needle);
  if (idx >= 0) return 10 + idx;
  return 1000;
}

function menuKeyForType(type) {
  return TYPE_MENU[type] || 'apis';
}

function flattenGroups(groups) {
  const out = [];
  for (const [type, rows] of Object.entries(groups || {})) {
    for (const row of rows || []) out.push({ ...row, type });
  }
  out.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || String(a.name || a.title).localeCompare(String(b.name || b.title)));
  return out;
}

module.exports = { escapeLike, normalizeQuery, rankResult, menuKeyForType, flattenGroups };
