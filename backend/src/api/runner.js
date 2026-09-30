'use strict';

const { query } = require('./db');
const { resolveAuthHeader, applyAuthHeader, normalizeProvider } = require('./authToken');
const { FormulaRunner } = require('../sandbox/formulaRunner');
const { evaluateAssertions } = require('../engine/assertions');
const { serializeBody, methodsWithoutBody, defaultContentType } = require('./bodyCodec');

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

// Node's fetch wraps every network-level failure in a bare
// `TypeError: fetch failed`; the actionable reason (ECONNREFUSED, ENOTFOUND,
// timeout, TLS) lives in `err.cause` (possibly an AggregateError from
// happy-eyeballs). Discarding it left users with "fetch failed" + httpStatus 0
// and no way to tell why the call never got a response.
function describeFetchError(err) {
  if (!err) return 'Request failed';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return 'Request timed out after 15000ms';
  }
  const leaf = (e) => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.map(leaf).find(Boolean) : e);
  const cause = leaf(err.cause);
  if (cause && cause.code) {
    const target = cause.address ? ` ${cause.address}${cause.port ? `:${cause.port}` : ''}` : '';
    return target ? `${cause.code} connecting to${target}` : String(cause.code);
  }
  if (cause && cause.message) return `${err.message}: ${cause.message}`;
  return String(err.message || err);
}

// A stored request that points at localhost/127.0.0.1 works only when the
// service runs on the machine executing the request. Runs execute on the
// MockShift server, so "localhost" means the server — not the caller's laptop.
function localhostHint(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(url)
    ? ' — "localhost" refers to the MockShift server, not your computer'
    : '';
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
  if ((bodyType === 'JSON' || bodyType === 'GRAPHQL') && input.bodyJson !== undefined && input.bodyJson !== null) {
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
  } else if (bodyType !== 'JSON' && bodyType !== 'GRAPHQL' && typeof input.bodyJson === 'string') {
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

function requestSnapshotOf(prepared) {
  return {
    url: prepared.url,
    method: prepared.method,
    headers: prepared.fetchHeaders,
    body: prepared.snapshotBody ?? null,
  };
}

/**
 * Resolve a request up to (but not including) the HTTP call:
 * - resolves environment variables ({{key}})
 * - applies the pre-request sandbox formula (may mutate req / $vars)
 * - applies the folder auth provider (calls the AUTH request, extracts the
 *   token, injects the configured header)
 * - substitutes variables and builds the final headers/body
 * The returned shape can either be fetched server-side (fetchPrepared) or
 * handed to the browser so the call can originate from the user's own network.
 */
async function preparePipeline({ request, vars, userId }) {
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
      (request.body_type === 'JSON' || request.body_type === 'GRAPHQL') && request.body_json
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
    const working = {
      ...request,
      body_json:
        req.body !== null && typeof req.body === 'object'
          ? req.body
          : request.body_json,
      body_text: typeof req.body === 'string' ? req.body : request.body_text,
    };
    const encoded = serializeBody(working, { substitute, vars });
    if (encoded.body !== null && encoded.body !== undefined) {
      body = encoded.body;
      snapshotBody = encoded.snapshot ?? encoded.body;
    } else {
      body =
        req.body !== null && req.body !== undefined
          ? typeof req.body === 'string'
            ? substitute(req.body, vars)
            : JSON.stringify(req.body)
          : null;
      snapshotBody = body;
    }
    if (body && !Object.keys(fetchHeaders).some((k) => k.toLowerCase() === 'content-type')) {
      fetchHeaders['Content-Type'] =
        encoded.contentType ||
        defaultContentType({ bodyType: request.body_type, apiType: request.api_type });
    }
  }

  return {
    url,
    method: req.method,
    fetchHeaders,
    body,
    snapshotBody,
    multipart: multipartParts,
    resolvedAuth,
    variables: vars,
  };
}

/**
 * Perform the HTTP call for a prepared request and capture a response snapshot.
 * Network failures are turned into an actionable message (never thrown).
 */
async function fetchPrepared(prepared) {
  const startedAt = new Date().toISOString();
  const fetchStarted = Date.now();
  let httpStatus = 0;
  let responseSnapshot = null;
  let error = null;
  try {
    const res = await fetch(prepared.url, {
      method: prepared.method,
      headers: prepared.fetchHeaders,
      body: methodsWithoutBody(prepared.method) ? undefined : prepared.body,
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
  } catch (err) {
    error = describeFetchError(err) + localhostHint(prepared.url);
  }
  return {
    httpStatus,
    responseSnapshot,
    error,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate assertions and (optionally) persist run_history / test_results for a
 * completed run. `fetchResult` carries the response snapshot — either captured
 * server-side (fetchPrepared) or reported by the browser.
 */
async function finalizeRun({ request, prepared, fetchResult, userId, persistHistory }) {
  const { httpStatus, responseSnapshot, error, startedAt, finishedAt } = fetchResult;
  const status = error ? 'FAILED' : httpStatus >= 400 ? 'FAILED' : 'SUCCESS';

  const testResults = evaluateAssertions(request.assertions || [], responseSnapshot || {});
  const assertionsPassed = testResults.length > 0 && testResults.every((t) => t.passed);
  const requestSnapshot = requestSnapshotOf(prepared);

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
        JSON.stringify(requestSnapshot),
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
    resolvedAuth: prepared.resolvedAuth ?? null,
    requestSnapshot,
    variables: prepared.variables ?? {},
    testResults,
    assertionsPassed,
  };
}

/**
 * Core request execution pipeline, shared by stored requests and in-memory
 * (ephemeral) runs. Resolves the request, performs the HTTP call server-side,
 * then evaluates assertions and records history when persistHistory is true.
 */
async function executePipeline({ request, vars, userId, persistHistory }) {
  const prepared = await preparePipeline({ request, vars, userId });
  const fetchResult = await fetchPrepared(prepared);
  return finalizeRun({ request, prepared, fetchResult, userId, persistHistory });
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

/**
 * Resolve an in-memory request without executing it, so the browser can
 * perform a call that must originate from the caller's own network
 * (localhost / private hosts the MockShift server cannot reach). Multipart
 * bodies build a Node FormData that cannot cross the wire, so they are flagged
 * (`multipart: true`) for the caller to keep on the server path.
 */
async function prepareInMemoryRequest(input, userId) {
  const request = normalizeInMemoryRequest(input);
  const vars = request.collection_id
    ? await resolveVariables({ collectionId: request.collection_id }, userId)
    : {};
  const prepared = await preparePipeline({ request, vars, userId });
  return {
    prepared: {
      url: prepared.url,
      method: prepared.method,
      headers: prepared.fetchHeaders,
      body: prepared.multipart ? null : prepared.body,
      multipart: prepared.multipart,
    },
    variables: prepared.variables,
    requestSnapshot: requestSnapshotOf(prepared),
  };
}

// Normalise a browser-reported response into the server's response-snapshot
// shape. Returns null when nothing usable was reported (call treated as error).
function clientResponseSnapshot(clientResponse) {
  if (!clientResponse || clientResponse.status === undefined || clientResponse.status === null) {
    return null;
  }
  return {
    status: Number(clientResponse.status) || 0,
    statusText: String(clientResponse.statusText || ''),
    headers:
      clientResponse.headers && typeof clientResponse.headers === 'object'
        ? clientResponse.headers
        : {},
    body: typeof clientResponse.body === 'string' ? clientResponse.body : '',
    bodyEncoding: clientResponse.bodyEncoding === 'base64' ? 'base64' : 'text',
    durationMs: Number(clientResponse.durationMs) || 0,
  };
}

/**
 * Finalize a run whose HTTP call was executed by the browser. `prepared` is
 * echoed back by the client (the resolved request it actually sent); assertions
 * come from the same request definition. Evaluate + optionally persist history.
 */
async function completeInMemoryRequest(input, userId) {
  const request = normalizeInMemoryRequest(input);
  const p = input.prepared || {};
  const variables = request.collection_id
    ? await resolveVariables({ collectionId: request.collection_id }, userId)
    : {};
  const prepared = {
    url: typeof p.url === 'string' ? p.url : '',
    method: String(p.method || request.method || 'GET').toUpperCase(),
    fetchHeaders: p.headers && typeof p.headers === 'object' ? p.headers : {},
    snapshotBody: p.body ?? null,
    multipart: Boolean(p.multipart),
    resolvedAuth: null,
    variables,
  };
  const responseSnapshot = clientResponseSnapshot(input.clientResponse);
  const fetchResult = {
    httpStatus: responseSnapshot ? responseSnapshot.status : 0,
    responseSnapshot,
    error: typeof input.error === 'string' && input.error ? input.error : null,
    startedAt: typeof input.startedAt === 'string' && input.startedAt ? input.startedAt : new Date().toISOString(),
    finishedAt: typeof input.finishedAt === 'string' && input.finishedAt ? input.finishedAt : new Date().toISOString(),
  };
  return finalizeRun({
    request,
    prepared,
    fetchResult,
    userId,
    persistHistory: Boolean(input.persistHistory),
  });
}

module.exports = {
  runRequest,
  runInMemoryRequest,
  prepareInMemoryRequest,
  completeInMemoryRequest,
  runTokenRequest,
  substitute,
  resolveVariables,
  loadRequest,
  loadAuthProvider,
  executePipeline,
  preparePipeline,
  finalizeRun,
  isMultipartPartsRequest,
  buildMultipartBody,
  MAX_FILE_PART_BYTES,
  MAX_TOTAL_FILE_BYTES,
  describeFetchError,
};
