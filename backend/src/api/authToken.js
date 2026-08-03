'use strict';

/**
 * Folder-level auth provider: call one AUTH-type request, read the token out
 * of its JSON response at a JSON path, and inject `prefix + token` into the
 * configured header of every request in the folder.
 */

const TOKEN_PATH_RE = /^['"]?([A-Za-z0-9_\-]+)['"]?$/;

function splitPath(path) {
  if (typeof path !== 'string' || !path.trim()) return [];
  // Accepts dotted ("data.access_token"), bracketed ("data['access_token']",
  // 'data["access_token"]') and numeric indexes ("items[0].token").
  const tokens = [];
  const cleaned = path.replace(/\[['"]?([^\]'"]+)['"]?\]/g, '.$1');
  for (const part of cleaned.split('.')) {
    if (part) tokens.push(part);
  }
  return tokens;
}

/**
 * Read a value out of a JSON-parsed body via a token path.
 *
 * @param {unknown} body
 * @param {string} path e.g. "access_token" or "data.access_token"
 * @returns {unknown} undefined when missing
 */
function extractToken(body, path) {
  const parts = splitPath(path);
  if (parts.length === 0) return undefined;
  let current = body;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    const index = /^\d+$/.test(part) ? Number(part) : part;
    if (!(index in Object(current))) return undefined;
    current = current[index];
  }
  return current;
}

function tokenToHeaderValue(token, prefix) {
  if (typeof token === 'string') return token;
  if (typeof token === 'number' || typeof token === 'boolean') return String(token);
  if (token !== null && typeof token === 'object') return JSON.stringify(token);
  return null;
}

/**
 * Compute the auth header a provider would inject for a given token response.
 *
 * @param {{ authType: string, tokenPath?: string, headerKey?: string, headerPrefix?: string }} provider
 * @param {unknown} tokenBody JSON-parsed response of the AUTH request
 * @returns {{ headerKey: string, headerValue: string } | null}
 */
function resolveAuthHeader(provider, tokenBody) {
  const type = provider.authType || 'NONE';
  if (type === 'NONE') return null;

  const headerKey = provider.headerKey || 'Authorization';

  if (type === 'BASIC') {
    // Credentials come from request variables at run time; the provider only
    // configures the header shape.
    return { headerKey, headerValue: 'Basic <resolved at run time>' };
  }

  const token = extractToken(tokenBody, provider.tokenPath || '');
  if (token === undefined) {
    throw new Error(
      `Auth provider could not find token at path "${provider.tokenPath || ''}" in the token response.`
    );
  }
  const raw = tokenToHeaderValue(token, provider.headerPrefix);
  if (raw === null) {
    throw new Error(`Auth provider token at "${provider.tokenPath}" is not a scalar value.`);
  }
  const prefix = (provider.headerPrefix || '').trim();
  return { headerKey, headerValue: prefix ? `${prefix} ${raw}` : raw };
}

/**
 * Apply a resolved auth header into a header list, replacing an existing
 * entry with the same key.
 *
 * @param {Array<{key:string,value:string,enabled:boolean}>} headers
 * @param {{headerKey:string,headerValue:string}} resolved
 */
function applyAuthHeader(headers, resolved) {
  if (!resolved) return headers;
  const key = resolved.headerKey;
  const without = headers.filter(
    (h) => h.key.toLowerCase() !== key.toLowerCase()
  );
  return [{ key, value: resolved.headerValue, enabled: true }, ...without];
}

/**
 * Normalize a raw DB row (snake_case columns) into the camelCase shape used by
 * resolveAuthHeader / the frontend.
 */
function normalizeProvider(row) {
  if (!row) return null;
  return {
    authType: row.auth_type || 'NONE',
    tokenRequestId: row.token_request_id || null,
    tokenPath: row.token_path || '',
    headerKey: row.header_key || 'Authorization',
    headerPrefix: row.header_prefix || '',
  };
}

module.exports = { extractToken, resolveAuthHeader, applyAuthHeader, splitPath, normalizeProvider, TOKEN_PATH_RE };
