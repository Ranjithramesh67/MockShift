'use strict';

function parseGraphqlBody(raw) {
  const empty = { query: '', variables: '{}', operationName: '' };
  if (raw == null || raw === '') return empty;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    let variables = '{}';
    if (raw.variables !== undefined) {
      variables =
        typeof raw.variables === 'string'
          ? raw.variables
          : JSON.stringify(raw.variables, null, 2);
    }
    return {
      query: String(raw.query ?? ''),
      variables,
      operationName: String(raw.operationName ?? ''),
    };
  }
  const text = String(raw);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parseGraphqlBody(parsed);
  } catch {
    return { query: text, variables: '{}', operationName: '' };
  }
  return empty;
}

function serializeGraphqlBody({ query = '', variables = '{}', operationName = '' } = {}) {
  const out = { query: String(query || '') };
  const rawVars = typeof variables === 'string' ? variables.trim() : variables;
  if (rawVars && rawVars !== '{}') {
    if (typeof rawVars === 'string') {
      try {
        out.variables = JSON.parse(rawVars);
      } catch {
        out.variables = rawVars;
      }
    } else {
      out.variables = rawVars;
    }
  } else if (rawVars === '{}') {
    out.variables = {};
  }
  if (operationName) out.operationName = String(operationName);
  return JSON.stringify(out, null, 2);
}

function graphqlErrors(response) {
  if (!response || response.bodyEncoding === 'base64') return [];
  const body = response.body;
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.errors)) return [];
  return parsed.errors
    .map((e) => ({ message: String(e && e.message ? e.message : 'GraphQL error') }))
    .filter((e) => e.message);
}

module.exports = { parseGraphqlBody, serializeGraphqlBody, graphqlErrors };
