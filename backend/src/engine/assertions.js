'use strict';

/**
 * Response assertions for requests. Pure, dependency-free helpers so the same
 * evaluation logic can be unit-tested and reused by the runner.
 *
 * Assertion shape:
 *   {
 *     id: string,
 *     type: 'status' | 'jsonPath' | 'header' | 'responseTime',
 *     operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt',
 *     path?: string,    // jsonPath: dot path into the parsed body; header: header name
 *     expected?: string // value compared against (numbers parsed when needed)
 *   }
 */

// Resolve a dot path (e.g. 'data.items.0.id') against an object or array.
function resolvePath(obj, path) {
  if (!path) return undefined;
  return String(path)
    .split('.')
    .reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
      return acc[key];
    }, obj);
}

// Parse a text body into JSON when possible; binary (base64) bodies never parse.
function parseBody(body, bodyEncoding) {
  if (bodyEncoding === 'base64') return null;
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function findHeader(headers, name) {
  const lower = String(name || '').toLowerCase();
  if (!lower) return undefined;
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function compare(actual, operator, expected) {
  const expectedNum = Number(expected);
  const numeric = expected !== '' && !Number.isNaN(expectedNum) && typeof actual === 'number';
  const a = numeric ? actual : String(actual);
  const b = numeric ? expectedNum : String(expected);
  switch (operator) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'contains':
      return String(a).includes(String(b));
    case 'gt':
      return a > b;
    case 'lt':
      return a < b;
    default:
      return false;
  }
}

/**
 * Evaluate a list of assertions against a response snapshot.
 * @param {Array<object>} assertions
 * @param {{ status: number, headers: object, body: string, bodyEncoding?: string, durationMs: number }} response
 * @returns {Array<{ id: string, passed: boolean, message: string }>}
 */
function evaluateAssertions(assertions, response) {
  const results = [];
  for (const a of assertions || []) {
    if (!a || !a.type || !a.operator) continue;
    const operator = a.operator;
    const expected = String(a.expected ?? '');
    let actual;
    let context;

    switch (a.type) {
      case 'status':
        actual = response.status;
        context = 'status';
        break;
      case 'responseTime':
        actual = response.durationMs;
        context = 'response time';
        break;
      case 'header':
        actual = findHeader(response.headers, a.path);
        context = `header "${a.path}"`;
        break;
      case 'jsonPath': {
        const parsed = parseBody(response.body, response.bodyEncoding);
        actual = parsed === null ? undefined : resolvePath(parsed, a.path);
        context = `body.${a.path || ''}`;
        break;
      }
      default:
        results.push({ id: a.id, passed: false, message: `Unknown assertion type "${a.type}"` });
        continue;
    }

    const passed = actual !== undefined && compare(actual, operator, expected);
    const shown = typeof actual === 'string' ? JSON.stringify(actual) : String(actual ?? 'undefined');
    results.push({ id: a.id, passed, message: `${context} ${operator} ${expected}: actual ${shown}` });
  }
  return results;
}

module.exports = { evaluateAssertions, resolvePath, parseBody };
