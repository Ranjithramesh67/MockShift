'use strict';

const { query } = require('./db');
const { resolveAuthHeader, applyAuthHeader, normalizeProvider } = require('./authToken');
const { FormulaRunner } = require('../sandbox/formulaRunner');
const { evaluateAssertions } = require('../engine/assertions');

const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_\-\.]+)\s*\}\}/g;

// Structured multipart/form-data bodies (api_requests.body_parts). File bytes
// travel with the run payload (base64) and are never persisted.
const MAX_FILE_PART_BYTES = 10 * 1024 * 1024; // 10 MB per file part
const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024; // 20 MB of file bytes per request

const formulaRunner = new FormulaRunner({ timeoutMs: 150 });

function substitute(input, variables) {
  if (typeof input !== 'string') return input;
  return input.replace(TEMPLATE_RE, (match, key) => {
    if (key in variables) return String(variables[key]);
    return match;
  });
}

// The workspace's ACTIVE environment (is_active=true), or NULL when none is
// set. Keyed off a stored request or a collection (for in-memory runs).
async function activeEnvironmentId({ requestId = null, collectionId = null }, userId) {
  const target = requestId ?? collectionId;
  if (!target) return null;
  const { rows } = await query(
    `SELECT e.id
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
       JOIN projects p  ON p.workspace_id = w.id
       JOIN collections c ON c.project_id = p.id
       ${requestId ? 'JOIN api_requests ar ON ar.collection_id = c.id' : ''}
      WHERE ${requestId ? 'ar.id = $1' : 'c.id = $1'} AND e.is_active = true
      LIMIT 1`,
    [target],
    { userId }
  );
  return rows[0]?.id ?? null;
}

async function resolveVariables({ requestId = null, collectionId = null }, userId) {
  const environmentId = await activeEnvironmentId({ requestId, collectionId }, userId);
  const { rows } = await query(
    `SELECT key, value FROM app.resolve_variables($1, $2)`,
    [requestId, environmentId],
    { userId }
  );
  const vars = {};
  for (const r of rows) vars[r.key] = r.value;
  return vars;
}

async function loadRequest(requestId) {
  const { rows } = await query(
    `SELECT id, name, method, url, headers, query_params, body_type, body_json, body_text,
            body_parts, api_type, collection_id, formula, assertions
       FROM api_requests WHERE id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

async function loadAuthProvider(collectionId) {
  if (!collectionId) return null;
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

// True when a request carries structured multipart parts (the body_parts path).
// Legacy MULTIPART requests that only have raw text (body_text) keep their old
// text/plain serialisation so nothing pre-existing regresses.
function isMultipartPartsRequest(request) {
  return (
    request.body_type === 'MULTIPART' &&
    Array.isArray(request.body_parts) &&
    request.body_parts.some((p) => p && typeof p === 'object' && p.enabled !== false && p.key)
  );
}

function assertMultipartFileLimit(totalBytes) {
  if (totalBytes > MAX_TOTAL_FILE_BYTES) {
    throw Object.assign(new Error('Total multipart file upload exceeds the 20 MB limit'), {
      status: 400,
    });
  }
}

/**
 * Build a real multipart/form-data body from structured parts.
 * - text parts become plain form fields ({{var}} templates substituted)
 * - file parts are reconstructed from their base64 `data` bytes
 * Returns { form, summary } where `summary` is a compact, JSON-serialisable
 * description used for request snapshots/history (never the raw bytes).
 */
async function buildMultipartBody(request, vars) {
  const form = new FormData();
  let totalFileBytes = 0;
  const summary = [];
  for (const part of request.body_parts || []) {
    if (!part || typeof part !== 'object' || part.enabled === false) continue;
    const key = String(part.key ?? '').trim();
    if (!key) continue;
    if (part.kind === 'file') {
      const data = typeof part.data === 'string' ? part.data : '';
      if (!data) {
        throw Object.assign(new Error(`Missing file data for multipart part "${key}"`), {
          status: 400,
        });
      }
      const buf = Buffer.from(data, 'base64');
      if (buf.length > MAX_FILE_PART_BYTES) {
        throw Object.assign(new Error(`Multipart part "${key}" exceeds the 10 MB file limit`), {
          status: 400,
        });
      }
      totalFileBytes += buf.length;
      assertMultipartFileLimit(totalFileBytes);
      const fileName = substitute(String(part.fileName || 'file'), vars).replace(/[\r\n"]/g, '');
      const mimeType = String(part.fileType || 'application/octet-stream').replace(/[\r\n]/g, '');
      form.append(key, new Blob([buf], { type: mimeType }), fileName);
      summary.push(`${key}=<${fileName}, ${buf.length} bytes>`);
    } else {
      const value = substitute(String(part.value ?? ''), vars);
      form.append(key, value);
      summary.push(`${key}=${value}`);
    }
  }
  return { form, summary: summary.join('; ') || '' };
}

async function runTokenRequest(tokenRequestId, userId) {
  const tokenReq = await loadRequest(tokenRequestId);
  if (!tokenReq) throw new Error('Auth token request not found');
  const vars = await resolveVariables({ requestId: tokenReq.id }, userId);
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

function normalizeInMemoryRequest(input = {}) {
  const bodyType = input.bodyType || 'NONE';
  let bodyJson = null;
  let bodyText = input.bodyText ?? null;
  if (bodyType === 'JSON' && input.bodyJson !== undefined && input.bodyJson !== null) {
    if (typeof input.bodyJson === 'string') {
      try {
        bodyJson = JSON.parse(input.bodyJson);
        bodyText = null;
      } catch {
        bodyText = input.bodyJson;
      }
    } else {
      bodyJson = input.bodyJson;
    }
  } else if (bodyType !== 'JSON' && typeof input.bodyJson === 'string') {
    bodyText = input.bodyJson;
  }
  return {
    id: input.id || null,
    name: input.name || '',
    method: String(input.method || 'GET').toUpperCase(),
    url: input.url || '',
    headers: Array.isArray(input.headers) ? input.headers : [],
    query_params: Array.isArray(input.queryParams) ? input.queryParams : [],
    body_type: bodyType,
    body_json: bodyJson,
    body_text: bodyText,
    body_parts: Array.isArray(input.bodyParts) ? input.bodyParts : null,
    api_type: input.apiType || 'REST',
    collection_id: input.collectionId || null,
    formula: input.formula || '',
    assertions: Array.isArray(input.assertions) ? input.assertions : [],
  };
}

/**
 * Core request execution pipeline, shared by stored requests and in-memory
 * (ephemeral) runs.
 * - resolves environment variables ({{key}})
 * - applies the pre-request sandbox formula (may mutate req / $vars)
 * - applies the folder auth provider (calls the AUTH request, extracts the
 *   token, injects the configured header)
 * - performs the HTTP call
 * - evaluates assertions
 * - records run_history / test_results only when persistHistory is true
 *   (request_id may be NULL for in-memory runs; the nullable FK allows it)
 */
async function executePipeline({ request, vars, userId, persistHistory }) {
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
  let fetchHeaders = headersObject(headers);

  // Multipart parts (text + file) build a native FormData body so Node's fetch
  // supplies the correct multipart/form-data content-type + boundary. A legacy
  // raw-text MULTIPART request (no parts) keeps the plain serialisation below.
  const multipartParts = isMultipartPartsRequest(request);

  let body = null;
  let snapshotBody = null;
  if (multipartParts) {
    const built = await buildMultipartBody(request, vars);
    body = built.form;
    snapshotBody = built.summary;
    // Drop any caller-set Content-Type: undici must set the boundary itself or
    // the multipart body would be rejected by the upstream server.
    fetchHeaders = Object.fromEntries(
      Object.entries(fetchHeaders).filter(([k]) => k.toLowerCase() !== 'content-type')
    );
  } else {
    body =
      req.body !== null && req.body !== undefined
        ? typeof req.body === 'string'
          ? substitute(req.body, vars)
          : JSON.stringify(req.body)
        : null;
    snapshotBody = body;
    if (body && !Object.keys(fetchHeaders).some((k) => k.toLowerCase() === 'content-type')) {
      fetchHeaders['Content-Type'] =
        request.body_type === 'JSON' ? 'application/json' : request.body_type === 'FORM_URLENCODED' ? 'application/x-www-form-urlencoded' : 'text/plain';
    }
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
    let responseBody;
    let bodyEncoding = 'text';
    if (isBinary) {
      responseBody = Buffer.from(await res.arrayBuffer()).toString('base64');
      bodyEncoding = 'base64';
    } else {
      responseBody = await res.text();
    }
    responseSnapshot = {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
      body: responseBody,
      bodyEncoding,
      durationMs: Date.now() - fetchStarted,
    };
    if (res.status >= 400) status = 'FAILED';
  } catch (err) {
    status = 'FAILED';
    error = String(err.message || err);
  }
  const finishedAt = new Date().toISOString();

  const testResults = evaluateAssertions(request.assertions || [], responseSnapshot || {});
  const assertionsPassed = testResults.length > 0 && testResults.every((t) => t.passed);

  let runId = null;
  if (persistHistory) {
    const { rows: runRows } = await query(
      `INSERT INTO run_history
         (request_id, user_id, trigger, status, request_snapshot, response_snapshot, started_at, finished_at)
       VALUES ($1, $2, 'MANUAL', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        request.id,
        userId,
        status,
        JSON.stringify({ url, method: req.method, headers: fetchHeaders, body: snapshotBody ?? null }),
        responseSnapshot ? JSON.stringify(responseSnapshot) : null,
        startedAt,
        finishedAt,
      ],
      { userId }
    );
    runId = runRows[0]?.id || null;

    for (const t of testResults) {
      await query(
        `INSERT INTO test_results (run_id, test_name, passed, assertions, error)
         VALUES ($1, $2, $3, $4, $5)`,
        [runId, t.message, t.passed, JSON.stringify(t), t.passed ? null : t.message]
      );
    }
  }

  return {
    runId,
    runStatus: status,
    httpStatus,
    error,
    response: responseSnapshot,
    resolvedAuth,
    requestSnapshot: {
      url,
      method: req.method,
      headers: fetchHeaders,
      body: snapshotBody ?? null,
    },
    variables: vars,
    testResults,
    assertionsPassed,
  };
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
  const vars = await resolveVariables({ requestId: request.id }, userId);
  return executePipeline({ request, vars, userId, persistHistory: true });
}

/**
 * Execute an in-memory request shape (no stored row required). Used by the
 * ephemeral POST /api/runs endpoint and the scratchpad flow.
 * - optional `collectionId` enables env-var resolution and the folder auth
 *   provider
 * - run_history is only written when `persistHistory` is true (request_id is
 *   NULL then, which the nullable FK permits)
 */
async function runInMemoryRequest(input, userId) {
  const request = normalizeInMemoryRequest(input);
  const vars = request.collection_id
    ? await resolveVariables({ collectionId: request.collection_id }, userId)
    : {};
  return executePipeline({
    request,
    vars,
    userId,
    persistHistory: Boolean(input.persistHistory),
  });
}

module.exports = {
  runRequest,
  runInMemoryRequest,
  runTokenRequest,
  substitute,
  resolveVariables,
  loadRequest,
  loadAuthProvider,
  isMultipartPartsRequest,
  buildMultipartBody,
  MAX_FILE_PART_BYTES,
  MAX_TOTAL_FILE_BYTES,
};
