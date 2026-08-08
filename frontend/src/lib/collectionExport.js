'use strict';

/**
 * Client-side helpers for collection export / import.
 *
 * - `parseCollectionFile(text)`  — validate that a JSON file looks like an
 *   API Hub collection export and return a normalized summary for the import UI.
 * - `collectionFileName(name)`   — safe `.json` download filename.
 * - `buildCurl(collection)`      — per-request `curl` commands (reuses the
 *   editor's `generateCurl`).
 * - `buildOpenApi(collection)`   — a minimal OpenAPI 3.0 document derived from
 *   the collection's REST requests.
 */

const { generateCurl } = require('./curl');

const COLLECTION_FORMAT = 'api-hub-collection';

function collectionFileName(name) {
  const base = String(name || 'collection')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'collection'}.json`;
}

/**
 * Parse + lightly validate an uploaded export file. Throws with a friendly
 * message when the content is not a usable API Hub collection export.
 *
 * @param {string} text
 * @returns {{ name: string, requestCount: number, data: unknown }}
 */
function parseCollectionFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid collection file.');
  }
  if (!Array.isArray(data.requests)) {
    throw new Error('Collection file is missing a "requests" array.');
  }
  const name =
    typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported collection';
  return { name, requestCount: data.requests.length, data };
}

function contentTypeForBodyType(bodyType) {
  switch (bodyType) {
    case 'JSON':
    case 'GRAPHQL':
      return 'application/json';
    case 'FORM_URLENCODED':
      return 'application/x-www-form-urlencoded';
    case 'MULTIPART':
      return 'multipart/form-data';
    case 'RAW_TEXT':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}

function bodyJsonToString(bodyJson) {
  if (bodyJson === null || bodyJson === undefined) return null;
  return typeof bodyJson === 'string' ? bodyJson : JSON.stringify(bodyJson);
}

/**
 * Per-request `curl` commands, one entry per request (name + command).
 *
 * @param {{ requests: Array<Record<string, unknown>> }} collection
 * @returns {Array<{ name: string, curl: string }>}
 */
function buildCurl(collection) {
  return (collection.requests || []).map((r) => ({
    name: r.name,
    curl: generateCurl({
      method: r.method || 'GET',
      url: r.url || '',
      headers: r.headers || [],
      queryParams: r.queryParams || [],
      bodyType: r.bodyType || 'NONE',
      bodyJson: bodyJsonToString(r.bodyJson),
      bodyText: r.bodyText || null,
      contentType: contentTypeForBodyType(r.bodyType),
    }),
  }));
}

/**
 * Minimal OpenAPI 3.0 document for the collection's REST requests. Non-REST
 * requests (SOAP/GRAPHQL/AUTH) are skipped.
 *
 * @param {{ name?: string, requests: Array<Record<string, unknown>> }} collection
 * @returns {Record<string, unknown>}
 */
function buildOpenApi(collection) {
  const paths = {};
  for (const req of collection.requests || []) {
    const apiType = req.apiType || 'REST';
    if (apiType !== 'REST') continue;
    const method = String(req.method || 'GET').toLowerCase();
    if (method === 'head' || method === 'options') continue;

    let pathname = '/';
    const url = String(req.url || '');
    try {
      pathname = new URL(url).pathname;
    } catch {
      const qIdx = url.indexOf('?');
      pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
      if (!pathname) pathname = '/';
    }

    const op = { summary: req.name };
    const parameters = [];
    for (const p of req.queryParams || []) {
      if (!p || p.enabled === false || !p.key) continue;
      parameters.push({ name: String(p.key), in: 'query', schema: { type: 'string' } });
    }
    for (const h of req.headers || []) {
      if (!h || h.enabled === false || !h.key) continue;
      if (String(h.key).toLowerCase() === 'content-type') continue;
      parameters.push({ name: String(h.key), in: 'header', schema: { type: 'string' } });
    }
    if (parameters.length) op.parameters = parameters;

    if (req.bodyJson || req.bodyText) {
      op.requestBody = {
        content: {
          'application/json': { schema: { type: 'object' } },
        },
      };
    }

    paths[pathname] = paths[pathname] || {};
    paths[pathname][method] = op;
  }
  return {
    openapi: '3.0.0',
    info: { title: collection.name || 'Imported collection', version: '1.0.0' },
    paths,
  };
}

/**
 * Serialize exported content into the text form for a chosen download format.
 *
 * @param {string} format 'json' | 'curl' | 'openapi'
 * @param {unknown} collection The exported collection payload.
 * @returns {string}
 */
function formatForDownload(format, collection) {
  if (format === 'curl') {
    const lines = buildCurl(collection).map((c) => `# ${c.name}\n${c.curl}`);
    return lines.join('\n\n') + '\n';
  }
  if (format === 'openapi') {
    return JSON.stringify(buildOpenApi(collection), null, 2) + '\n';
  }
  return JSON.stringify(collection, null, 2) + '\n';
}

module.exports = {
  COLLECTION_FORMAT,
  collectionFileName,
  parseCollectionFile,
  buildCurl,
  buildOpenApi,
  formatForDownload,
};
