'use strict';

// Map a friendly `expects` object into the API Hub assertion shape:
//   { id, type: 'status'|'jsonPath'|'header'|'responseTime',
//     operator: 'eq'|'neq'|'contains'|'gt'|'lt', path?, expected? }
function normalizeExpects(expects = {}) {
  const out = [];
  let n = 0;
  const nextId = () => `sdk-a${++n}`;

  if (expects.status !== undefined) {
    out.push({ id: nextId(), type: 'status', operator: 'eq', expected: String(expects.status) });
  }
  for (const [path, expected] of Object.entries(expects.json || {})) {
    out.push({ id: nextId(), type: 'jsonPath', operator: 'eq', path, expected: String(expected) });
  }
  for (const [name, expected] of Object.entries(expects.headers || {})) {
    out.push({ id: nextId(), type: 'header', operator: 'contains', path: name, expected: String(expected) });
  }
  if (expects.responseTimeMs !== undefined) {
    out.push({ id: nextId(), type: 'responseTime', operator: 'lt', expected: String(expects.responseTimeMs) });
  }
  return out;
}

module.exports = { normalizeExpects };
