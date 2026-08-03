'use strict';

class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HEADER_KEY_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function assertSafeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new RequestValidationError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RequestValidationError(`Unsupported protocol: ${parsed.protocol}`);
  }
  if (!parsed.hostname) {
    throw new RequestValidationError('URL must include a host');
  }
  return parsed;
}

function assertSafeMethod(method) {
  if (!ALLOWED_METHODS.has(method)) {
    throw new RequestValidationError(`Unsupported method: ${method}`);
  }
}

function assertSafeHeaders(headers) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (UNSAFE_KEYS.has(key) || !HEADER_KEY_RE.test(key)) {
      throw new RequestValidationError(`Unsafe header name: ${key}`);
    }
    if (typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new RequestValidationError(`Unsafe header value for: ${key}`);
    }
  }
}

function stripUnsafeKeys(value) {
  if (Array.isArray(value)) {
    return value.map(stripUnsafeKeys);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      if (!UNSAFE_KEYS.has(key)) {
        out[key] = stripUnsafeKeys(value[key]);
      }
    }
    return out;
  }
  return value;
}

function sanitizeRequest(req, { maxBodyBytes = 1000000 } = {}) {
  if (!req || typeof req !== 'object') {
    throw new RequestValidationError('Request must be an object');
  }
  assertSafeMethod(req.method);
  assertSafeUrl(req.url);
  assertSafeHeaders(req.headers);
  req.headers = stripUnsafeKeys(req.headers || {});
  req.query = stripUnsafeKeys(req.query || {});
  req.body = stripUnsafeKeys(req.body);
  if (typeof req.body === 'string' && Buffer.byteLength(req.body, 'utf8') > maxBodyBytes) {
    throw new RequestValidationError('Request body exceeds size limit');
  }
  return req;
}

module.exports = { sanitizeRequest, RequestValidationError };
