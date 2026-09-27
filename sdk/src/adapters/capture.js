'use strict';

// ---------------------------------------------------------------------------
// Runtime capture: observe real requests/responses and hand them to the hub so
// it can infer payload + response structure and suggest assertions.
//
// Two attachment points:
//   * express middleware  -> capture.middleware(hub)
//   * any http.Server     -> capture.attachHttp(hub, server)
//
// Capture never throws into the host app: every callback is wrapped.
// ---------------------------------------------------------------------------

const { pathMatches } = require('../match');
const { collapsePath } = require('../infer');

// `res.getHeader()` does not see headers passed straight to `writeHead()`, so
// the instrumented response also records those separately.
function contentType(res, declaredHeaders) {
  const declared = declaredHeaders && declaredHeaders['content-type'];
  const raw = declared || (res.getHeader ? res.getHeader('content-type') : null);
  return String(raw || '');
}

function parseBody(text, type) {
  if (!text) return { kind: 'empty', value: null };
  if (/json/i.test(type)) {
    try {
      return { kind: 'json', value: JSON.parse(text) };
    } catch {
      return { kind: 'text', value: text };
    }
  }
  return { kind: 'text', value: text };
}

function shouldCapture(hub, req) {
  const cap = hub.config.capture || {};
  if (!cap.enabled) return false;
  const url = req.originalUrl || req.url || '/';
  const pathname = url.split('?')[0];
  return pathMatches(pathname, hub.config);
}

function finalize(hub, req, res, rawBody, durationMs, declaredHeaders) {
  const url = req.originalUrl || req.url || '/';
  const pathname = url.split('?')[0];
  const type = contentType(res, declaredHeaders);
  const cap = hub.config.capture || {};
  const parsed = cap.responseBodies ? parseBody(rawBody, type) : { kind: 'skipped', value: null };

  const observation = {
    method: String(req.method || 'GET').toUpperCase(),
    path: pathname,
    template: collapsePath(pathname, hub.config),
    status: res.statusCode,
    durationMs: Math.round(durationMs),
    apiType: /json/i.test(type) ? 'REST' : 'HTTP',
    responseType: type || null,
    query: req.query && Object.keys(req.query).length ? req.query : null,
    requestBody: null,
    responseBody: parsed.kind === 'json' ? parsed.value : null,
    responseText: parsed.kind === 'text' ? parsed.value : null,
  };

  if (cap.requestBodies && req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      observation.requestBody = req.body.length ? req.body : null;
    } else if (Buffer.isBuffer(req.body)) {
      observation.requestBody = req.body.length ? req.body.toString('utf8') : null;
    } else if (typeof req.body === 'object') {
      observation.requestBody = req.body;
    }
  }

  hub.record(observation);
}

function instrument(hub, req, res) {
  const cap = hub.config.capture || {};
  const maxBytes = Number(cap.maxBodyBytes) || 100000;
  const start = process.hrtime.bigint();
  const chunks = [];
  let size = 0;
  let done = false;
  let declaredHeaders = null;

  const collect = (chunk) => {
    if (!chunk || !cap.responseBodies || size >= maxBytes) return;
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(typeof chunk === 'string' ? chunk : String(chunk));
    const remaining = maxBytes - size;
    chunks.push(buf.length > remaining ? buf.subarray(0, remaining) : buf);
    size += Math.min(buf.length, remaining);
  };

  const finish = () => {
    if (done) return;
    done = true;
    try {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      finalize(hub, req, res, Buffer.concat(chunks).toString('utf8'), durationMs, declaredHeaders);
    } catch (err) {
      if (typeof hub.config.onError === 'function') hub.config.onError(err);
    }
  };

  const origWriteHead = res.writeHead;
  const origWrite = res.write;
  const origEnd = res.end;

  res.writeHead = function patchedWriteHead(statusCode, ...rest) {
    try {
      const headers = typeof rest[0] === 'string' ? rest[1] : rest[0];
      if (headers && typeof headers === 'object') {
        declaredHeaders = { ...(declaredHeaders || {}), ...headers };
      }
    } catch {
      /* ignore */
    }
    return origWriteHead.apply(this, [statusCode, ...rest]);
  };

  res.write = function patchedWrite(chunk, ...rest) {
    try {
      collect(chunk);
    } catch {
      /* ignore */
    }
    return origWrite.apply(this, [chunk, ...rest]);
  };

  res.end = function patchedEnd(chunk, ...rest) {
    if (typeof chunk !== 'function') {
      try {
        collect(chunk);
      } catch {
        /* ignore */
      }
    }
    finish();
    return origEnd.apply(this, [chunk, ...rest]);
  };

  res.on('close', finish);
  return true;
}

function middleware(hub) {
  return function mockshiftCapture(req, res, next) {
    try {
      if (shouldCapture(hub, req)) instrument(hub, req, res);
    } catch (err) {
      if (typeof hub.config.onError === 'function') hub.config.onError(err);
    }
    return next();
  };
}

// Attach to a raw node http.Server by wrapping its `emit`. Pass
// { autoSync: false } when the caller (e.g. the Express adapter) already
// handles the sync-on-listen so it isn't triggered twice.
function attachHttp(hub, server, options = {}) {
  if (!server || typeof server.emit !== 'function') {
    throw new TypeError('mockshift.http(server): a valid http.Server / express app is required');
  }
  if (server.__mockshiftAttached) return hub;
  const originalEmit = server.emit;
  server.emit = function patchedEmit(type, ...args) {
    if (type === 'request') {
      const [req, res] = args;
      try {
        if (shouldCapture(hub, req)) instrument(hub, req, res);
      } catch (err) {
        if (typeof hub.config.onError === 'function') hub.config.onError(err);
      }
    }
    return originalEmit.apply(this, [type, ...args]);
  };
  server.__mockshiftAttached = true;
  if (options.autoSync !== false && hub.config.autoSync && typeof server.on === 'function') {
    server.on('listening', () => hub.syncSoon());
  }
  return hub;
}

module.exports = { middleware, attachHttp, instrument, shouldCapture, parseBody };
