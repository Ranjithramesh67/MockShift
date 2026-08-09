'use strict';

const { Router } = require('express');
const { query, pool } = require('../db');
const { requireAuth, getProjectAccess, roleAtLeast } = require('../access');
const { logAudit } = require('../audit');
const { redactRequestRecord } = require('../redact');

const router = Router();
router.use(requireAuth);

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BODY_TYPES = ['NONE', 'JSON', 'FORM_URLENCODED', 'MULTIPART', 'RAW_TEXT', 'GRAPHQL'];
const API_TYPES = ['REST', 'SOAP', 'GRAPHQL', 'AUTH'];
const AUTH_TYPES = ['NONE', 'BASIC', 'BEARER_TOKEN', 'OAUTH2'];
const EXPORT_FORMAT = 'api-hub-collection';
const EXPORT_VERSION = 1;

async function canReadProject(userId, projectId) {
  return Boolean(await getProjectAccess(userId, projectId));
}

async function canWriteProject(userId, projectId) {
  const access = await getProjectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

async function collectionOf(collectionId) {
  const { rows } = await query(
    `SELECT id, name, project_id FROM collections WHERE id = $1`,
    [collectionId]
  );
  return rows[0] || null;
}

// ------------------------------------------------------------------ Export
// Serialize a collection (name, requests with full editor state, optional auth
// provider) into the portable api-hub-collection JSON shape.
async function serializeCollection(collectionId) {
  const collection = await collectionOf(collectionId);
  if (!collection) return null;

  const { rows: requests } = await query(
    `SELECT id, name, method, url, headers, query_params, body_type, body_json,
            body_text, api_type, formula, assertions
       FROM api_requests
      WHERE collection_id = $1
      ORDER BY name`,
    [collectionId]
  );

  const { rows: authRows } = await query(
    `SELECT auth_type, token_request_id, token_path, header_key, header_prefix
       FROM auth_providers WHERE collection_id = $1`,
    [collectionId]
  );
  const authRow = authRows[0];

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    name: collection.name,
    requests: requests.map((r) => {
      const safe = redactRequestRecord(r, {});
      return {
        sourceId: safe.id,
        name: safe.name,
        method: safe.method,
        url: safe.url,
        headers: safe.headers || [],
        queryParams: safe.query_params || [],
        bodyType: safe.body_type,
        bodyJson: safe.body_json ?? null,
        bodyText: safe.body_text ?? null,
        apiType: safe.api_type,
        formula: safe.formula || '',
        assertions: safe.assertions || [],
      };
    }),
    authProvider: authRow
      ? {
          authType: authRow.auth_type || 'NONE',
          tokenRequestId: authRow.token_request_id || null,
          tokenPath: authRow.token_path || '',
          headerKey: authRow.header_key || 'Authorization',
          headerPrefix: authRow.header_prefix || '',
        }
      : null,
  };
}

router.get('/collections/:collectionId/export', async (req, res, next) => {
  try {
    const collection = await collectionOf(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canReadProject(req.user.id, collection.project_id))) {
      return res.status(403).json({ error: 'No access to this collection' });
    }
    const payload = await serializeCollection(req.params.collectionId);
    await logAudit({
      actorId: req.user.id,
      entityType: 'collection',
      entityId: collection.id,
      action: 'export_collection',
      detail: { projectId: collection.project_id },
      ip: req.ip,
    });
    res.json({ collection: payload });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Import
function cleanString(value, maxLen = 500) {
  return typeof value === 'string' ? value.slice(0, maxLen) : null;
}

function cleanKvArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((kv) => kv && typeof kv === 'object')
    .map((kv) => ({
      key: cleanString(kv.key, 200) ?? '',
      value: cleanString(kv.value, 4000) ?? '',
      enabled: kv.enabled !== false,
    }))
    .filter((kv) => kv.key);
}

function cleanAssertions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((a) => a && typeof a === 'object');
}

function validateRequest(input, index) {
  if (!input || typeof input !== 'object') {
    return { error: `Request #${index + 1} is invalid` };
  }
  const name = cleanString(input.name, 500);
  if (!name) return { error: `Request #${index + 1}: name is required` };
  const method = HTTP_METHODS.includes(input.method) ? input.method : 'GET';
  const apiType = API_TYPES.includes(input.apiType) ? input.apiType : 'REST';
  const bodyType = BODY_TYPES.includes(input.bodyType) ? input.bodyType : 'NONE';
  const url = typeof input.url === 'string' ? input.url.slice(0, 4000) : '';
  const formula = typeof input.formula === 'string' ? input.formula.slice(0, 20000) : '';
  let bodyJson = input.bodyJson ?? null;
  if (typeof bodyJson === 'string') {
    const trimmed = bodyJson.trim();
    try {
      bodyJson = JSON.parse(trimmed);
    } catch {
      bodyJson = null;
    }
  } else if (bodyJson !== null && typeof bodyJson !== 'object') {
    bodyJson = null;
  }
  const bodyText = typeof input.bodyText === 'string' ? input.bodyText.slice(0, 200000) : null;
  return {
    value: {
      sourceId: typeof input.sourceId === 'string' ? input.sourceId : null,
      name,
      method,
      url,
      apiType,
      bodyType,
      bodyJson,
      bodyText,
      formula,
      headers: cleanKvArray(input.headers),
      queryParams: cleanKvArray(input.queryParams),
      assertions: cleanAssertions(input.assertions),
    },
  };
}

router.post('/collections/import', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { projectId, name, collection } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    if (!(await canWriteProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const collectionName = cleanString(name || collection?.name, 500);
    if (!collectionName) return res.status(400).json({ error: 'Collection name is required' });
    if (!collection || typeof collection !== 'object' || !Array.isArray(collection.requests)) {
      return res.status(400).json({ error: 'collection.requests must be an array' });
    }

    const validated = [];
    for (let i = 0; i < collection.requests.length; i += 1) {
      const parsed = validateRequest(collection.requests[i], i);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      validated.push(parsed.value);
    }

    await client.query('BEGIN');
    const { rows: colRows } = await client.query(
      `INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id, name, project_id`,
      [projectId, collectionName]
    );
    const newCollection = colRows[0];

    const created = [];
    const idMap = new Map();
    for (const r of validated) {
      const { rows: reqRows } = await client.query(
        `INSERT INTO api_requests
           (collection_id, name, method, url, api_type, headers, query_params,
            body_type, body_json, body_text, formula, assertions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, name, method, url, api_type`,
        [
          newCollection.id,
          r.name,
          r.method,
          r.url,
          r.apiType,
          JSON.stringify(r.headers),
          JSON.stringify(r.queryParams),
          r.bodyType,
          r.bodyJson,
          r.bodyText,
          r.formula,
          JSON.stringify(r.assertions),
        ]
      );
      if (r.sourceId) idMap.set(r.sourceId, reqRows[0].id);
      created.push(reqRows[0]);
    }

    const authProvider = collection.authProvider || null;
    if (authProvider && AUTH_TYPES.includes(authProvider.authType) && authProvider.authType !== 'NONE') {
      const tokenRequestId = authProvider.tokenRequestId
        ? (idMap.get(authProvider.tokenRequestId) || null)
        : null;
      await client.query(
        `INSERT INTO auth_providers
           (collection_id, auth_type, token_request_id, token_path, header_key, header_prefix)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (collection_id) DO UPDATE SET
           auth_type = EXCLUDED.auth_type,
           token_request_id = EXCLUDED.token_request_id,
           token_path = EXCLUDED.token_path,
           header_key = EXCLUDED.header_key,
           header_prefix = EXCLUDED.header_prefix`,
        [
          newCollection.id,
          authProvider.authType,
          tokenRequestId,
          cleanString(authProvider.tokenPath, 1000) ?? '',
          cleanString(authProvider.headerKey, 200) ?? 'Authorization',
          cleanString(authProvider.headerPrefix, 200) ?? 'Bearer',
        ]
      );
    }

    await client.query('COMMIT');
    await logAudit({
      actorId: req.user.id,
      entityType: 'collection',
      entityId: newCollection.id,
      action: 'import_collection',
      detail: { projectId, name: collectionName, requestCount: created.length },
      ip: req.ip,
    });
    res.status(201).json({ collection: newCollection, requests: created });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
