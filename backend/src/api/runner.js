'use strict';

const { query } = require('./db');
const { resolveAuthHeader, applyAuthHeader, normalizeProvider } = require('./authToken');
const { FormulaRunner } = require('../sandbox/formulaRunner');

const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_\-\.]+)\s*\}\}/g;

const formulaRunner = new FormulaRunner({ timeoutMs: 150 });

function substitute(input, variables) {
  if (typeof input !== 'string') return input;
  return input.replace(TEMPLATE_RE, (match, key) => {
    if (key in variables) return String(variables[key]);
    return match;
  });
}

async function resolveVariables(requestId, userId) {
  const { rows } = await query(
    `SELECT key, value FROM app.resolve_variables($1, NULL)`,
    [requestId],
    { userId }
  );
  const vars = {};
  for (const r of rows) vars[r.key] = r.value;
  return vars;
}

async function loadRequest(requestId) {
  const { rows } = await query(
    `SELECT id, name, method, url, headers, query_params, body_type, body_json, body_text,
            api_type, collection_id, formula
       FROM api_requests WHERE id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

async function loadAuthProvider(collectionId) {
  const { rows } = await query(
    `SELECT auth_type, token_request_id, token_path, header_key, header_prefix
       FROM auth_providers WHERE collection_id = $1`,
    [collectionId]
  );
  return normalizeProvider(rows[0]);
}

function headersObject(headersArray) {
  const out = {};
  for (const h of headersArray || []) {
    if (h && h.enabled !== false && h.key) out[h.key] = h.value;
  }
  return out;
}

async function runTokenRequest(tokenRequestId, userId) {
  const tokenReq = await loadRequest(tokenRequestId);
  if (!tokenReq) throw new Error('Auth token request not found');
  const vars = await resolveVariables(tokenReq.id, userId);
  const url = substitute(tokenReq.url, vars);
  const method = (tokenReq.method || 'POST').toUpperCase();
  const headers = headersObject(tokenReq.headers);
  const body =
    tokenReq.body_type === 'JSON' && tokenReq.body_json
      ? JSON.stringify(tokenReq.body_json)
      : tokenReq.body_text || null;
  const fetchHeaders = { ...headers };
  if (body && !Object.keys(fetchHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    fetchHeaders['Content-Type'] =
      tokenReq.body_type === 'JSON' ? 'application/json' : 'text/plain';
  }
  const response = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: ['GET', 'HEAD'].includes(method) ? undefined : body,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: text, parsed, headers: Object.fromEntries(response.headers) };
}

/**
 * Execute a stored request for a user.
 * - resolves environment variables ({{key}})
 * - applies the pre-request sandbox formula (may mutate req / $vars)
 * - applies the folder auth provider (calls the AUTH request, extracts the
 *   token, injects the configured header)
 * - performs the HTTP call and records run_history
 */
async function runRequest(requestId, userId) {
  const request = await loadRequest(requestId);
  if (!request) throw Object.assign(new Error('Request not found'), { status: 404 });

  let vars = await resolveVariables(request.id, userId);
  let resolvedAuth = null;
  const provider = await loadAuthProvider(request.collection_id);

  if (provider && provider.authType !== 'NONE' && provider.tokenRequestId) {
    const tokenRun = await runTokenRequest(provider.tokenRequestId, userId);
    if (tokenRun.status >= 400) {
      throw new Error(`Auth token request failed with HTTP ${tokenRun.status}: ${tokenRun.body}`);
    }
    if (!tokenRun.parsed || typeof tokenRun.parsed !== 'object') {
      throw new Error('Auth token request did not return a JSON body');
    }
    resolvedAuth = resolveAuthHeader(provider, tokenRun.parsed);
  }

  const req = {
    method: (request.method || 'GET').toUpperCase(),
    url: request.url,
    headers: headersObject(request.headers),
    query: Object.fromEntries((request.query_params || []).map((q) => [q.key, q.value])),
    body:
      request.body_type === 'JSON' && request.body_json
        ? JSON.parse(JSON.stringify(request.body_json))
        : request.body_text ?? null,
  };

  if (request.formula) {
    const outcome = await formulaRunner.run({ source: request.formula, req, vars });
    if (outcome.req !== undefined) Object.assign(req, outcome.req);
    if (outcome.vars !== undefined) vars = outcome.vars;
  }

  const url = substitute(req.url, vars);
  if (!/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error(`Unsupported URL scheme: ${url}`), { status: 400 });
  }

  let headers = Object.entries(req.headers || {}).map(([key, value]) => ({
    key,
    value: substitute(value, vars),
    enabled: true,
  }));
  if (resolvedAuth) headers = applyAuthHeader(headers, resolvedAuth);
  const fetchHeaders = headersObject(headers);

  const body =
    req.body !== null && req.body !== undefined
      ? typeof req.body === 'string'
        ? substitute(req.body, vars)
        : JSON.stringify(req.body)
      : null;

  if (body && !Object.keys(fetchHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    fetchHeaders['Content-Type'] =
      request.body_type === 'JSON' ? 'application/json' : request.body_type === 'FORM_URLENCODED' ? 'application/x-www-form-urlencoded' : 'text/plain';
  }

  const startedAt = new Date().toISOString();
  let status = 'SUCCESS';
  let responseSnapshot = null;
  let error = null;
  const fetchStarted = Date.now();
  let httpStatus = 0;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: fetchHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    httpStatus = res.status;
    const resContentType = res.headers.get('content-type') || '';
    const isBinary =
      /application\/pdf|image\/|audio\/|video\/|application\/octet-stream|application\/zip|application\/x-(?:zip|tar|gzip|7z|rar)/i.test(
        resContentType
      );
    let body;
    let bodyEncoding = 'text';
    if (isBinary) {
      body = Buffer.from(await res.arrayBuffer()).toString('base64');
      bodyEncoding = 'base64';
    } else {
      body = await res.text();
    }
    responseSnapshot = {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
      body,
      bodyEncoding,
      durationMs: Date.now() - fetchStarted,
    };
    if (res.status >= 400) status = 'FAILED';
  } catch (err) {
    status = 'FAILED';
    error = String(err.message || err);
  }
  const finishedAt = new Date().toISOString();

  await query(
    `INSERT INTO run_history
       (request_id, user_id, trigger, status, request_snapshot, response_snapshot, started_at, finished_at)
     VALUES ($1, $2, 'MANUAL', $3, $4, $5, $6, $7)`,
    [
      request.id,
      userId,
      status,
      JSON.stringify({ url, method: req.method, headers: fetchHeaders, body }),
      responseSnapshot ? JSON.stringify(responseSnapshot) : null,
      startedAt,
      finishedAt,
    ],
    { userId }
  );

  return {
    runStatus: status,
    httpStatus,
    error,
    response: responseSnapshot,
    resolvedAuth,
    requestSnapshot: { url, method: req.method, headers: fetchHeaders, body },
    variables: vars,
  };
}

module.exports = { runRequest, runTokenRequest, substitute, resolveVariables, loadRequest, loadAuthProvider };
