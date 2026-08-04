'use strict';

/**
 * Response display helpers for the request/response pane.
 *
 * Pure helpers (content detection, pretty-printing, base64 decoding) are
 * written as plain CommonJS so they can be unit-tested with node:test,
 * matching `curl.js` and `workflowValidation.js`.
 *
 * A response body may arrive in two encodings (see `bodyEncoding`):
 *   - 'text'  : the upstream content-type is textual, body is a string.
 *   - 'base64': the upstream content-type is binary (PDF, images, ...); the
 *     backend base64-encoded the raw bytes so they survive JSON transport.
 */

const PDF_MAGIC = '%PDF-';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode a base64 string into a binary (latin1) string. Own implementation
 * so it is pure JS and works identically in browsers, Node and the tests.
 */
function base64ToBinaryString(b64) {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return '';
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=') break;
    const val = B64_ALPHABET.indexOf(c);
    if (val < 0) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * Return the value of the `content-type` header (lower-cased header name,
 * original value), or '' when absent.
 */
function contentTypeOf(response) {
  if (!response || !response.headers) return '';
  const keys = Object.keys(response.headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === 'content-type') {
      return String(response.headers[keys[i]] || '');
    }
  }
  return '';
}

function isPdf(response) {
  if (!response) return false;
  const ct = contentTypeOf(response).toLowerCase();
  if (ct.includes('application/pdf')) return true;
  if (!response.body) return false;
  return String(response.body).slice(0, 1024).includes(PDF_MAGIC);
}

function isImage(response) {
  if (!response) return false;
  return /^image\//.test(contentTypeOf(response).toLowerCase());
}

function isBinaryResponse(response) {
  if (!response) return false;
  if (response.bodyEncoding === 'base64') return true;
  const ct = contentTypeOf(response).toLowerCase();
  return (
    isPdf(response) ||
    isImage(response) ||
    /audio\/|video\/|application\/octet-stream|application\/zip|application\/x-(?:zip|tar|gzip|7z|rar)/.test(ct)
  );
}

/**
 * Best CodeMirror language for a response body.
 */
function responseLanguage(response) {
  const ct = contentTypeOf(response).toLowerCase();
  if (ct.includes('xml') || ct.includes('graphql')) return 'xml';
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.startsWith('text/')) return 'text';
  return 'json';
}

/**
 * Re-indent XML/HTML markup by tag depth. Deliberately simple: it keeps
 * comments/CDATA intact and never reorders or re-quotes attributes.
 */
function prettifyMarkup(input) {
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g;
  const tokens = [];
  let m;
  while ((m = tagRe.exec(input)) !== null) tokens.push(m[0]);

  const SELF_CLOSING = /^<(?:\/?\s*(?:br|img|input|hr|meta|link|area|base|col|embed|source|track|wbr)\b|!--[\s\S]*?-->|!\[CDATA\[[\s\S]*?\]\]>|\?[\s\S]*?\?>)/i;
  const CLOSE_ONLY = /^<\s*\/\s*[\w-]+/;
  const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

  const out = [];
  let indent = 0;
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    if (!trimmed.startsWith('<')) {
      const text = trimmed.replace(/\s+/g, ' ').trim();
      if (text) out.push('  '.repeat(indent) + text);
      continue;
    }

    if (SELF_CLOSING.test(trimmed) || CLOSE_ONLY.test(trimmed)) {
      if (CLOSE_ONLY.test(trimmed)) indent = Math.max(0, indent - 1);
      out.push('  '.repeat(indent) + trimmed);
      continue;
    }

    const openMatch = /^<([\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*)(?:\/>|>)/.exec(trimmed);
    if (openMatch && !VOID.test(openMatch[1])) {
      out.push('  '.repeat(indent) + trimmed);
      indent += 1;
    } else {
      out.push('  '.repeat(indent) + trimmed);
    }
  }
  return out.join('\n');
}

/**
 * Format a response body for human reading. Returns the original body when
 * the content cannot be reformatted (e.g. already-minified non-JSON text).
 */
function prettify(body, language) {
  if (body == null || body === '') return '';
  if (language === 'json') {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch (err) {
      return body;
    }
  }
  if (language === 'xml' || language === 'html') {
    if (!body.includes('<')) return body;
    try {
      return prettifyMarkup(body);
    } catch (err) {
      return body;
    }
  }
  return body;
}

/**
 * Reconstruct the raw response bytes as a Blob, decoding base64 bodies.
 * Works in browsers and Node 18+ (which ship a Blob global).
 */
function responseBlob(response) {
  if (!response) return new Blob([]);
  const ct = contentTypeOf(response);
  const isBinary = response.bodyEncoding === 'base64';
  if (isBinary) {
    const bin = base64ToBinaryString(response.body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: ct || 'application/octet-stream' });
  }
  return new Blob([response.body], { type: ct || 'text/plain;charset=utf-8' });
}

/**
 * Derive a sensible download filename from the content type and request URL.
 */
function filenameForResponse(response, url) {
  const ct = contentTypeOf(response).toLowerCase();
  let ext = 'txt';
  if (ct.includes('pdf')) ext = 'pdf';
  else if (ct.includes('json')) ext = 'json';
  else if (ct.includes('xml')) ext = 'xml';
  else if (ct.includes('html')) ext = 'html';
  else if (ct.startsWith('image/')) {
    ext = ct.slice('image/'.length).split(';')[0].trim().split('+')[0] || 'img';
  } else if (ct.startsWith('text/')) ext = 'txt';

  let base = 'response';
  if (url) {
    const last = String(url).split('?')[0].split('#')[0].split('/').pop();
    if (last) {
      const nameMatch = /^(.+?)\.([a-z0-9]{1,8})$/i.exec(last);
      base = nameMatch ? nameMatch[1] : last;
    }
  }
  base = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'response';
  return `${base}.${ext}`;
}

/**
 * Trigger a browser download of the given blob. No-op outside a browser.
 */
function downloadBlob(blob, filename) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'response.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

module.exports = {
  PDF_MAGIC,
  base64ToBinaryString,
  contentTypeOf,
  isPdf,
  isImage,
  isBinaryResponse,
  responseLanguage,
  prettifyMarkup,
  prettify,
  responseBlob,
  filenameForResponse,
  downloadBlob,
};
