'use strict';

// ---------------------------------------------------------------------------
// Response / request shape inference and assertion suggestions.
//
// The SDK observes real traffic to learn what a route returns and what it
// accepts, then turns that into:
//   * a JSON-schema-ish description ({ type, properties, items, example })
//   * a list of suggested assertions in the MockShift engine shape
//     ({ id, type, operator, path?, expected? }) — see
//     backend/src/engine/assertions.js for the evaluator.
//
// Everything here is pure and dependency-free so it can be unit-tested.
// ---------------------------------------------------------------------------

const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const EXAMPLE_MAX = 80;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'object' | 'string' | 'number' | 'boolean' | 'undefined'
}

function exampleOf(value) {
  if (typeof value === 'string' && value.length > EXAMPLE_MAX) return `${value.slice(0, EXAMPLE_MAX)}…`;
  return value;
}

// Infer a compact schema for a JSON value.
function inferSchema(value, depth = 0) {
  const type = typeOf(value);
  if (depth >= MAX_DEPTH) return { type };
  if (type === 'array') {
    const sample = value.slice(0, MAX_ARRAY_ITEMS);
    const items = sample.length ? inferSchema(sample[0], depth + 1) : { type: 'unknown' };
    return { type: 'array', items };
  }
  if (type === 'object') {
    const properties = {};
    for (const [key, nested] of Object.entries(value)) {
      properties[key] = inferSchema(nested, depth + 1);
    }
    return { type: 'object', properties };
  }
  return { type, example: exampleOf(value) };
}

// Turn a concrete request path into a stable template:
//   /users/42/posts/9f1c...  ->  /users/:id/posts/:id
// Numeric and UUID-ish segments collapse to :id; other dynamic-looking
// segments (long hex / base64-ish) collapse too. Explicit rules from
// config.pathRules (e.g. { regex, replace }) run first.
function collapsePath(pathname, options = {}) {
  let path = String(pathname || '/');
  const hashIdx = path.indexOf('#');
  if (hashIdx >= 0) path = path.slice(0, hashIdx);
  const queryIdx = path.indexOf('?');
  if (queryIdx >= 0) path = path.slice(0, queryIdx);
  for (const rule of options.pathRules || []) {
    if (rule && rule.pattern) {
      path = path.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || ':id');
    }
  }
  const segments = path.split('/').map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
    if (/^[A-Za-z0-9_-]{20,}$/.test(seg) && /\d/.test(seg)) return ':id';
    return seg;
  });
  return segments.join('/') || '/';
}

function uniqueIdMaker(prefix = 'sdk') {
  let n = 0;
  return () => `${prefix}-a${++n}`;
}

// Pick a few stable, low-cardinality fields to assert on. We avoid arbitrary
// ids/uuids/timestamps because they change between runs.
function isAssertable(key, value) {
  if (/id$/i.test(key)) return false;
  if (/at$|time$|date$/i.test(key)) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' || typeof value === 'boolean';
}

// Build suggested assertions from an observed response.
//   { status, body (parsed JSON or null), durationMs }
//   config.assertions = { status: true, maxResponseTimeMs?, maxTopLevelFields? }
function suggestAssertions(observation, config = {}) {
  const opts = config.assertions || {};
  const nextId = uniqueIdMaker('sdk');
  const out = [];

  if (observation && typeof observation.status === 'number' && opts.status !== false) {
    const status = observation.status;
    if (opts.successStatus === 'range' || (opts.statusOperator === 'lt' && status < 400)) {
      out.push({ id: nextId(), type: 'status', operator: 'lt', expected: '400' });
    } else {
      out.push({ id: nextId(), type: 'status', operator: 'eq', expected: String(status) });
    }
  }

  if (opts.maxResponseTimeMs && observation && typeof observation.durationMs === 'number') {
    out.push({ id: nextId(), type: 'responseTime', operator: 'lt', expected: String(opts.maxResponseTimeMs) });
  }

  const body = observation && (observation.body !== undefined ? observation.body : observation.responseBody);
  if (body && typeof body === 'object' && !Array.isArray(body) && opts.json !== false) {
    const fields = Object.entries(body).filter(([k, v]) => isAssertable(k, v));
    const limit = Number.isFinite(opts.maxTopLevelFields) ? opts.maxTopLevelFields : 5;
    for (const [key, value] of fields.slice(0, limit)) {
      out.push({ id: nextId(), type: 'jsonPath', operator: 'eq', path: key, expected: String(value) });
    }
  }
  return out;
}

// Describe a payload/response for the UI without dumping secrets: keep the
// inferred schema plus a truncated sample.
function summarizeSample(value, maxBytes = 4000) {
  if (value === undefined) return null;
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text.length > maxBytes) {
    return { truncated: true, preview: text.slice(0, maxBytes) };
  }
  return JSON.parse(text);
}

// Merge two inferred schemas, widening types and unioning object properties.
// Used to accumulate structure across multiple captured samples.
function mergeSchema(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  if (a.type !== b.type) return { type: 'unknown' };
  if (a.type === 'object') {
    const properties = { ...(a.properties || {}) };
    for (const [key, value] of Object.entries(b.properties || {})) {
      properties[key] = properties[key] ? mergeSchema(properties[key], value) : value;
    }
    return { type: 'object', properties };
  }
  if (a.type === 'array') {
    return { type: 'array', items: mergeSchema(a.items, b.items) || { type: 'unknown' } };
  }
  return a;
}

// Suggest mock formulas (MockShift's per-request JS snippets) based on the
// fields a route appears to use. Suggestions are advisory only — we never
// overwrite an existing formula. See frontend/src/lib/formulaSnippets.js.
const FORMULA_FIELD_RULES = [
  { re: /^(id|_id|uuid|guid|ref|reference)$/i, code: '$utils.uuid()', reason: 'field looks like a generated id' },
  { re: /(created|updated|timestamp|_at$|^at$|date|time)/i, code: '$utils.now()', reason: 'field looks like a timestamp' },
  { re: /(email|mail)/i, code: '$utils.uuid() + "@example.com"', reason: 'field looks like an email' },
  { re: /(count|qty|quantity|amount|total|num|number)/i, code: '$utils.randomInt(1, 100)', reason: 'field looks like a numeric value' },
  { re: /(name|title|label|slug)/i, code: '"Sample " + $utils.randomInt(1, 1000)', reason: 'field looks like a text value' },
];

function suggestFormulas(route, config = {}) {
  const opts = config.assertions || {};
  if (opts.formulas === false) return [];
  const fields = new Set();
  const body = route && route.bodyJson;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of Object.keys(body)) fields.add(key);
  }
  const path = String((route && route.path) || '');
  const hasPathParam = /:[A-Za-z_][A-Za-z0-9_]*/.test(path);

  const out = [];
  if (hasPathParam) {
    out.push({ title: 'Unique path parameter', code: '$utils.uuid()', reason: 'route has a dynamic path segment' });
  }
  for (const field of fields) {
    for (const rule of FORMULA_FIELD_RULES) {
      if (rule.re.test(field)) {
        const target = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field) ? `req.body.${field}` : `req.body["${field}"]`;
        out.push({ title: `Set ${field}`, code: `${target} = ${rule.code}`, reason: rule.reason });
        break;
      }
    }
    if (out.length >= 5) break;
  }
  return out;
}

module.exports = {
  inferSchema,
  mergeSchema,
  collapsePath,
  suggestAssertions,
  suggestFormulas,
  summarizeSample,
  typeOf,
  isAssertable,
  MAX_DEPTH,
};
