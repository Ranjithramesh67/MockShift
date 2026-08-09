'use strict';

/**
 * Credential redaction for request/response snapshots.
 *
 * `redactSnapshot(snapshot, options)` returns a NEW deeply-cloned snapshot with
 * credentials replaced by the marker (default `«redacted»`). The input is never
 * mutated. Handles:
 *   - url          (query-string values + credentials in userinfo)
 *   - headers      (object form, as stored in snapshots)
 *   - body         (JSON / form-urlencoded / multipart / XML-SOAP / raw text)
 *     for both request snapshots and response snapshots
 *
 * Matching rules, applied in order:
 *   1. exact `secretValues` match (value === secret, or contained in a raw body)
 *   2. key-name pattern (case-insensitive, any depth):
 *        authorization|cookie|set-cookie|token|secret|password|passwd|
 *        api[-_]?key|client[-_]?secret|assertion|signature|sig
 *   3. JWT-shaped values (`xxx.yyy.zzz`) and auth-scheme values
 *      (`Bearer <token>`, `Basic <token>`, …)
 *
 * options: `{ secretValues: string[], extraKeyPatterns: RegExp[]|string[],
 *             marker: string }`
 */

const DEFAULT_MARKER = '\u00abredacted\u00bb';

const KEY_PATTERN =
  /authorization|cookie|set-cookie|token|secret|password|passwd|api[-_]?key|client[-_]?secret|assertion|signature|sig/i;

const JWT_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const AUTH_SCHEME_RE = /^(Bearer|Basic|Digest|Token|ApiKey)\s+\S+/i;

const QUERY_SEPARATOR_RE = /[?&]/;

function toPatterns(extraKeyPatterns) {
  return (extraKeyPatterns || []).map((p) => (p instanceof RegExp ? p : new RegExp(p, 'i')));
}

function matchesKeyName(key, patterns) {
  if (KEY_PATTERN.test(key)) return true;
  for (const p of patterns) {
    p.lastIndex = 0;
    if (p.test(key)) return true;
  }
  return false;
}

function looksLikeSecret(value, secretValues) {
  if (typeof value !== 'string' || value === '') return false;
  if (secretValues.some((s) => s !== '' && value === s)) return true;
  if (JWT_SHAPE_RE.test(value)) return true;
  if (AUTH_SCHEME_RE.test(value)) return true;
  return false;
}

// ---------------------------------------------------------------- deep clone

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

// --------------------------------------------------------------------- body

function redactStringValue(value, secretValues, marker) {
  let out = value;
  for (const s of secretValues) {
    if (s !== '' && out.includes(s)) out = out.split(s).join(marker);
  }
  return out;
}

function redactJson(value, secretValues, patterns, marker) {
  if (Array.isArray(value)) {
    return value.map((v) => redactJson(v, secretValues, patterns, marker));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (matchesKeyName(key, patterns)) {
        out[key] = marker;
      } else if (looksLikeSecret(val, secretValues)) {
        out[key] = marker;
      } else {
        out[key] = redactJson(val, secretValues, patterns, marker);
      }
    }
    return out;
  }
  return value;
}

function redactFormBody(body, secretValues, patterns, marker) {
  return body
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      const rawValue = pair.slice(eq + 1);
      const keyDecoded = safeDecodeURIComponent(key);
      const valueDecoded = safeDecodeURIComponent(rawValue);
      if (matchesKeyName(keyDecoded, patterns) || looksLikeSecret(valueDecoded, secretValues)) {
        return `${key}=${encodeURIComponent(marker)}`;
      }
      return pair;
    })
    .join('&');
}

function redactMultipartBody(body, secretValues, patterns, marker) {
  const boundaryMatch = body.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  let boundary = boundaryMatch ? `--${boundaryMatch[1] || boundaryMatch[2].trim()}` : null;
  if (!boundary) {
    const lead = body.match(/^--([^\r\n]+)/);
    if (lead) boundary = lead[0];
  }
  if (!boundary) return redactStringValue(body, secretValues, marker);
  return body
    .split(boundary)
    .map((part) => {
      if (part.trim() === '') return part;
      const nameMatch = part.match(/name="([^"]*)"/i);
      if (nameMatch && matchesKeyName(nameMatch[1], patterns)) {
        return part.replace(/\r?\n\r?\n([\s\S]*)$/, (match, content) => match.replace(content, marker));
      }
      if (nameMatch && looksLikeSecret(part.split(/\r?\n\r?\n/).pop(), secretValues)) {
        return part.replace(/\r?\n\r?\n([\s\S]*)$/, (match, content) => match.replace(content, marker));
      }
      return part;
    })
    .join(boundary);
}

function redactXmlBody(body, secretValues, patterns, marker) {
  // Tag content for credential-ish element names (any namespace prefix).
  let out = body.replace(
    /<((?:[A-Za-z_][\w.-]*:)?)([A-Za-z_][\w.-]*)(\s[^>]*)?>([^<]*)<\/(?:[A-Za-z_][\w.-]*:)?\2>/g,
    (m, ns, tag, attrs, content) => {
      if (matchesKeyName(tag, patterns)) return `<${ns}${tag}${attrs || ''}>${marker}</${ns}${tag}>`;
      return m;
    }
  );
  // Attribute values with credential-ish attribute names (e.g. wsse:Password).
  out = out.replace(
    /([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)="([^"]*)"/g,
    (m, ns, attr, value) => {
      if (matchesKeyName(attr, patterns)) return `${ns || ''}${attr}="${marker}"`;
      return m;
    }
  );
  // Fallback: raw secret values still sitting anywhere in the XML text.
  return redactStringValue(out, secretValues, marker);
}

function redactBody(body, secretValues, patterns, marker) {
  if (typeof body !== 'string' || body === '') return body;
  const trimmed = body.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJson(JSON.parse(body), secretValues, patterns, marker));
    } catch {
      // Not actually JSON — fall through to raw-text handling.
    }
  }

  if (trimmed.includes('=') && (trimmed.includes('&') || /^[A-Za-z0-9_\-%]+=/.test(trimmed))) {
    const looksForm = trimmed.split('&').every((pair) => {
      const eq = pair.indexOf('=');
      return eq !== -1 || pair === '';
    });
    if (looksForm && !trimmed.startsWith('<?xml')) return redactFormBody(body, secretValues, patterns, marker);
  }

  if (/Content-Disposition:\s*form-data/i.test(trimmed) || /^--[\w.-]+/m.test(trimmed)) {
    return redactMultipartBody(body, secretValues, patterns, marker);
  }

  if (/<[?A-Za-z_][\w.:-]*(\s|\/?>)/.test(trimmed)) {
    return redactXmlBody(body, secretValues, patterns, marker);
  }

  return redactStringValue(body, secretValues, marker);
}

// --------------------------------------------------------------------- url

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function redactUrl(url, secretValues, patterns, marker) {
  if (typeof url !== 'string' || url === '') return url;
  let out = url;
  const hashIdx = out.indexOf('#');
  const queryIdx = out.indexOf('?');

  // Credentials embedded in userinfo (https://user:pass@host/...).
  out = out.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, (m, scheme) => {
    return `${scheme}${marker}@`;
  });

  const qStart = queryIdx === -1 ? -1 : queryIdx;
  const qEnd = hashIdx === -1 ? out.length : hashIdx;
  if (qStart === -1) return out;

  const head = out.slice(0, qStart);
  const query = out.slice(qStart + 1, qEnd);
  const tail = hashIdx === -1 ? '' : out.slice(hashIdx);

  const redacted = query
    .split(QUERY_SEPARATOR_RE)
    .map((piece) => {
      if (piece === '') return '';
      const eq = piece.indexOf('=');
      if (eq === -1) {
        return matchesKeyName(safeDecodeURIComponent(piece), patterns) ? marker : piece;
      }
      const key = safeDecodeURIComponent(piece.slice(0, eq));
      const value = safeDecodeURIComponent(piece.slice(eq + 1));
      if (matchesKeyName(key, patterns) || looksLikeSecret(value, secretValues)) {
        return `${piece.slice(0, eq)}=${encodeURIComponent(marker)}`;
      }
      return piece;
    })
    .join('&');

  return `${head}?${redacted}${tail}`;
}

// ----------------------------------------------------------------- headers

function redactHeaders(headers, secretValues, patterns, marker) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (matchesKeyName(key, patterns)) {
      out[key] = marker;
    } else if (looksLikeSecret(value, secretValues)) {
      out[key] = marker;
    } else {
      out[key] = value;
    }
  }
  return out;
}

// KV-array form as stored on api_requests (headers / query_params):
//   [{ key, value, enabled }, ...]
function redactKvArray(kvs, secretValues, patterns, marker) {
  if (!Array.isArray(kvs)) return kvs;
  return kvs.map((kv) => {
    if (!kv || typeof kv !== 'object') return kv;
    const { key, value, enabled } = kv;
    const redacted =
      matchesKeyName(String(key ?? ''), patterns) || looksLikeSecret(value, secretValues);
    return redacted ? { ...kv, value: marker } : kv;
  });
}

// JSON value (already parsed) at any depth — used for request body_json.
function redactJsonValue(value, secretValues, patterns, marker) {
  return redactJson(value, secretValues, patterns, marker);
}

/**
 * Redact a stored request row (shape: { url, headers, query_params, body_json,
 * body_text }) without touching other fields. Returns a NEW object.
 */
function redactRequestRecord(record, options = {}) {
  if (!record || typeof record !== 'object') return record;
  const secretValues = (Array.isArray(options.secretValues) ? options.secretValues : []).filter(
    (s) => typeof s === 'string'
  );
  const patterns = toPatterns(options.extraKeyPatterns);
  const marker = typeof options.marker === 'string' && options.marker !== '' ? options.marker : DEFAULT_MARKER;

  const out = { ...record };
  if (typeof out.url === 'string') out.url = redactUrl(out.url, secretValues, patterns, marker);
  if (Array.isArray(out.headers)) out.headers = redactKvArray(out.headers, secretValues, patterns, marker);
  if (Array.isArray(out.query_params)) {
    out.query_params = redactKvArray(out.query_params, secretValues, patterns, marker);
  }
  if (out.body_json !== undefined && out.body_json !== null) {
    out.body_json = redactJsonValue(out.body_json, secretValues, patterns, marker);
  }
  if (typeof out.body_text === 'string' && out.body_text !== '') {
    out.body_text = redactBody(out.body_text, secretValues, patterns, marker);
  }
  return out;
}

// ----------------------------------------------------------------- snapshot

/**
 * Redact credentials from a request or response snapshot.
 * Returns a new object; the input is never mutated.
 *
 * Snapshot shape (as stored in run_history / shared via shares):
 *   { url?, headers?, body?, ... }  (request)
 *   { status?, headers?, body?, bodyEncoding?, ... }  (response)
 */
function redactSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;

  const secretValues = (Array.isArray(options.secretValues) ? options.secretValues : []).filter(
    (s) => typeof s === 'string'
  );
  const patterns = toPatterns(options.extraKeyPatterns);
  const marker = typeof options.marker === 'string' && options.marker !== '' ? options.marker : DEFAULT_MARKER;

  const out = clone(snapshot);

  if (typeof out.url === 'string') {
    out.url = redactUrl(out.url, secretValues, patterns, marker);
  }
  if (out.headers && typeof out.headers === 'object') {
    out.headers = redactHeaders(out.headers, secretValues, patterns, marker);
  }
  if (typeof out.body === 'string' && out.bodyEncoding !== 'base64') {
    out.body = redactBody(out.body, secretValues, patterns, marker);
  }
  return out;
}

module.exports = {
  redactSnapshot,
  redactRequestRecord,
  redactHeaders,
  redactKvArray,
  redactJsonValue,
  redactBody,
  redactUrl,
  DEFAULT_MARKER,
};
