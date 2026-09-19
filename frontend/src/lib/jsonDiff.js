'use strict';

function parseJsonInput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'JSON is empty' };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    const message = err && err.message ? err.message : 'Invalid JSON';
    return { ok: false, error: message };
  }
}

function pathJoin(base, key) {
  const root = base || '$';
  const token = String(key);
  if (/^\d+$/.test(token)) return `${root}[${token}]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) return `${root}.${token}`;
  return `${root}[${JSON.stringify(token)}]`;
}

function sameShape(left, right) {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right);
  return typeof left === typeof right;
}

function preview(value) {
  if (value === undefined) return '';
  try {
    const text = JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return String(value);
  }
}

function diffValue(left, right, path, out) {
  if (Object.is(left, right)) return;
  if (left === undefined) {
    out.push({ path: path || '$', kind: 'added', left: undefined, right });
    return;
  }
  if (right === undefined) {
    out.push({ path: path || '$', kind: 'removed', left, right: undefined });
    return;
  }
  if (!sameShape(left, right)) {
    out.push({ path: path || '$', kind: 'type', left, right });
    return;
  }
  if (Array.isArray(left)) {
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i += 1) {
      diffValue(left[i], right[i], pathJoin(path || '$', i), out);
    }
    return;
  }
  if (left && typeof left === 'object') {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      diffValue(left[key], right[key], pathJoin(path || '$', key), out);
    }
    return;
  }
  out.push({ path: path || '$', kind: 'changed', left, right });
}

function diffJson(left, right) {
  const changes = [];
  diffValue(left, right, '$', changes);
  return changes;
}

function summarizeDiff(changes) {
  const summary = { added: 0, removed: 0, changed: 0, type: 0, total: 0 };
  for (const item of changes) {
    if (item.kind === 'added') summary.added += 1;
    else if (item.kind === 'removed') summary.removed += 1;
    else if (item.kind === 'type') summary.type += 1;
    else summary.changed += 1;
  }
  summary.total = changes.length;
  return summary;
}

function compareParsed(left, right) {
  const changes = diffJson(left, right);
  return { equal: changes.length === 0, changes, summary: summarizeDiff(changes) };
}

module.exports = {
  parseJsonInput,
  pathJoin,
  preview,
  diffJson,
  summarizeDiff,
  compareParsed,
};
