'use strict';

// ============================================================================
// Pure matcher / sequence helpers for mock scenarios (E3).
//
// No database or Express dependency: everything takes a plain request context
// (`{ headers, query, body, params }`) and/or response rows so it can be unit
// tested in isolation and reused by the dispatch middleware.
//
// Condition DSL (stored in mock_route_responses.conditions):
//   { source: 'header'|'query'|'body', name, operator, value?, caseSensitive? }
// Operators:
//   equals, notEquals, contains, notContains, startsWith, endsWith,
//   regex, exists, notExists, in
// Every condition of a response must match (logical AND). An empty condition
// array matches every request.
//
// Response rows are the DB shape (snake_case). A few camelCase aliases are
// accepted so the same helpers work against hand-built fixtures.
// ============================================================================

const CONDITION_SOURCES = ['header', 'query', 'body'];
const CONDITION_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'regex',
  'exists',
  'notExists',
  'in',
];

// All-zero uuid sentinel: mock_sequence_state keys the default (no-scenario)
// sequence with this because PK columns cannot be NULL.
const DEFAULT_SCENARIO_ID = '00000000-0000-0000-0000-000000000000';

const SCENARIO_HEADER = 'x-mock-scenario';
const SCENARIO_QUERY_KEYS = ['__scenario', 'scenario'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function conditionErrorMessage(condition) {
  if (!isPlainObject(condition)) return 'each condition must be an object';
  const source = String(condition.source || '').toLowerCase();
  if (!CONDITION_SOURCES.includes(source)) {
    return `condition source must be one of ${CONDITION_SOURCES.join(', ')}`;
  }
  if (!String(condition.name || '').trim()) return 'condition name is required';
  const operator = candidateOperator(condition);
  if (!CONDITION_OPERATORS.includes(operator)) {
    return `condition operator must be one of ${CONDITION_OPERATORS.join(', ')}`;
  }
  if (!['exists', 'notExists'].includes(operator) && condition.value === undefined) {
    return `condition operator ${operator} requires a value`;
  }
  if (operator === 'in' && !Array.isArray(condition.value)) {
    return 'condition operator in requires an array value';
  }
  return null;
}

function candidateOperator(condition) {
  return String(condition.operator || 'equals');
}

// Normalise a raw condition into the canonical stored shape, or return an
// error string. Used by the route layer before persisting.
function normalizeCondition(condition) {
  const error = conditionErrorMessage(condition);
  if (error) return { error };
  return {
    value: {
      source: String(condition.source).toLowerCase(),
      name: String(condition.name).trim(),
      operator: candidateOperator(condition),
      value: condition.value,
      caseSensitive: condition.caseSensitive === true,
    },
  };
}

function normalizeConditions(conditions) {
  if (conditions === undefined || conditions === null) return { value: [] };
  if (!Array.isArray(conditions)) return { error: 'conditions must be an array' };
  const out = [];
  for (const raw of conditions) {
    const parsed = normalizeCondition(raw);
    if (parsed.error) return { error: parsed.error };
    out.push(parsed.value);
  }
  return { value: out };
}

// --------------------------------------------------------------- value lookup

function headerValue(headers, name) {
  if (!isPlainObject(headers)) return undefined;
  const target = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function queryValue(query, name) {
  if (!isPlainObject(query)) return undefined;
  if (Object.prototype.hasOwnProperty.call(query, name)) {
    const value = query[name];
    return Array.isArray(value) ? value[0] : value;
  }
  const target = String(name).toLowerCase();
  for (const key of Object.keys(query)) {
    if (key.toLowerCase() === target) {
      const value = query[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

// Dot/bracket-free path lookup into a parsed JSON body: "a.b.c" or "items.0".
function bodyValue(body, name) {
  if (!isPlainObject(body)) return undefined;
  if (Object.prototype.hasOwnProperty.call(body, name)) return body[name];
  const parts = String(name).split('.');
  let cursor = body;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function resolveValue(source, name, context) {
  if (source === 'header') return headerValue(context.headers, name);
  if (source === 'query') return queryValue(context.query, name);
  if (source === 'body') return bodyValue(context.body, name);
  if (source === 'path' || source === 'param') return context.params ? context.params[name] : undefined;
  return undefined;
}

function scalar(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ------------------------------------------------------------ condition match

function conditionMatches(condition, context) {
  if (!isPlainObject(condition)) return false;
  const source = String(condition.source || '').toLowerCase();
  const name = String(condition.name || '');
  const operator = candidateOperator(condition);
  const actual = resolveValue(source, name, context);
  const present = actual !== undefined && actual !== null;

  if (operator === 'exists') return present;
  if (operator === 'notExists') return !present;

  const caseSensitive = condition.caseSensitive === true;
  const wanted = scalar(condition.value);
  let observed = scalar(actual);
  if (!caseSensitive) {
    observed = observed.toLowerCase();
  }
  const expected = caseSensitive ? wanted : wanted.toLowerCase();
  const haystack = caseSensitive ? scalar(actual) : scalar(actual).toLowerCase();

  switch (operator) {
    case 'equals':
      return observed === expected;
    case 'notEquals':
      return observed !== expected;
    case 'contains':
      return haystack.includes(expected);
    case 'notContains':
      return !haystack.includes(expected);
    case 'startsWith':
      return haystack.startsWith(expected);
    case 'endsWith':
      return haystack.endsWith(expected);
    case 'in':
      return Array.isArray(condition.value)
        ? condition.value.map((v) => (caseSensitive ? scalar(v) : scalar(v).toLowerCase())).includes(observed)
        : false;
    case 'regex': {
      let re;
      try {
        re = new RegExp(wanted, caseSensitive ? '' : 'i');
      } catch {
        return false;
      }
      return re.test(scalar(actual));
    }
    default:
      return false;
  }
}

function conditionsMatch(conditions, context) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((condition) => conditionMatches(condition, context));
}

// --------------------------------------------------------------- request ctx

function requestContext(req, params) {
  const body = isPlainObject(req && req.body)
    ? req.body
    : req && typeof req.body === 'string' && req.body
      ? safeJsonParse(req.body)
      : {};
  return {
    headers: (req && req.headers) || {},
    query: (req && req.query) || {},
    body: body || {},
    params: params || {},
  };
}

function safeJsonParse(text) {
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Scenario activation precedence: X-Mock-Scenario header first, then the
// __scenario / scenario query params. Returns a trimmed name or null.
function scenarioFromRequest(req) {
  const header = headerValue((req && req.headers) || {}, SCENARIO_HEADER);
  if (header !== undefined && header !== null && String(header).trim()) {
    return String(header).trim();
  }
  const query = (req && req.query) || {};
  for (const key of SCENARIO_QUERY_KEYS) {
    const value = queryValue(query, key);
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

// ------------------------------------------------------------ response picks

function responseScenarioId(response) {
  const value = response.scenario_id !== undefined ? response.scenario_id : response.scenarioId;
  return value === undefined || value === null ? null : String(value);
}

function responseSequenceIndex(response) {
  const value =
    response.sequence_index !== undefined ? response.sequence_index : response.sequenceIndex;
  return value === undefined || value === null ? null : Number(value);
}

function responsePriority(response) {
  const value = response.priority;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function byPriorityThenCreated(a, b) {
  const pa = responsePriority(a);
  const pb = responsePriority(b);
  if (pb !== pa) return pb - pa;
  const ca = a.created_at ? String(a.created_at) : '';
  const cb = b.created_at ? String(b.created_at) : '';
  return ca.localeCompare(cb);
}

/**
 * Pick the next response for a route.
 *
 * Precedence (scenario-specific overrides always win over the default set):
 *   1. conditional responses (sequence_index null) whose conditions all match,
 *      ordered by priority desc then created_at;
 *   2. the ordered sequence, when one exists (caller advances the cursor).
 *
 * Returns one of:
 *   { kind: 'conditional', response }
 *   { kind: 'sequence', responses: [...], mode: 'cycle'|'advance' }
 *   null  (fall through to the base mock_routes row)
 */
function pickResponse(responses, scenarioId, context) {
  const list = Array.isArray(responses) ? responses : [];
  const activeScenario = scenarioId ? String(scenarioId) : null;
  const groups = activeScenario
    ? [list.filter((r) => responseScenarioId(r) === activeScenario), list.filter((r) => responseScenarioId(r) === null)]
    : [list.filter((r) => responseScenarioId(r) === null)];

  for (const group of groups) {
    const conditionals = group
      .filter((r) => responseSequenceIndex(r) === null)
      .sort(byPriorityThenCreated);
    for (const response of conditionals) {
      if (conditionsMatch(response.conditions, context)) {
        return { kind: 'conditional', response };
      }
    }
  }

  for (const group of groups) {
    const sequence = group
      .filter((r) => responseSequenceIndex(r) !== null)
      .sort((a, b) => responseSequenceIndex(a) - responseSequenceIndex(b));
    if (sequence.length > 0) {
      const mode = sequence[0].sequence_mode === 'advance' ? 'advance' : 'cycle';
      return { kind: 'sequence', responses: sequence, mode };
    }
  }

  return null;
}

// Zero-based index served for the Nth call (cursor is the 1-based call count
// after the increment). 'cycle' wraps; 'advance' clamps on the last slot.
function sequenceIndexFor(cursor, length, mode) {
  if (!Number.isFinite(cursor) || length <= 0) return 0;
  const calls = Math.max(1, Math.floor(cursor));
  if (mode === 'advance') return Math.min(calls - 1, length - 1);
  return (calls - 1) % length;
}

module.exports = {
  CONDITION_SOURCES,
  CONDITION_OPERATORS,
  DEFAULT_SCENARIO_ID,
  SCENARIO_HEADER,
  SCENARIO_QUERY_KEYS,
  normalizeCondition,
  normalizeConditions,
  conditionMatches,
  conditionsMatch,
  resolveValue,
  requestContext,
  scenarioFromRequest,
  pickResponse,
  sequenceIndexFor,
  responseScenarioId,
  responseSequenceIndex,
};
