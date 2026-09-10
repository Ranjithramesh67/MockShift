'use strict';

// E1 — OpenAPI import + contract validation.
//
// Mount point (coordinator seam in backend/src/api/server.js):
//   app.use('/api/contracts', require('./routes/contracts'));
//
//   POST /contracts/import         parse a 3.x JSON spec, store it, and (by
//                                  default) generate a collection/folders/
//                                  requests from its paths.
//   GET  /contracts?projectId=     list imported specs for a project.
//   GET  /contracts/:specId        stored spec + its operations.
//   POST /contracts/diff           diff two stored specs (or two raw specs).
//   POST /contracts/validate       validate a live response body against an
//                                  operation's response schema.
//   POST /contracts/checks         attach an operation/response to a request
//                                  (the `contract` assertion source).
//   GET  /contracts/checks?requestId=  list a request's contract checks.
//   POST /contracts/validate-request   evaluate every attached check against a
//                                  live response.
//   DELETE /contracts/checks/:checkId
//
// Access mirrors content.js: reads need project access, writes need EDITOR+.

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, roleAtLeast, getProjectAccess } = require('../access');
const {
  checkCountGate,
  orgOfProject,
} = require('../entitlements');
const {
  parseSpec,
  generateRequests,
  collectOperations,
  getResponseSchema,
  diffSpecs,
  hashSpec,
  normalizePath,
  normalizeMethod,
  normalizeStatusCode,
  validateResponse,
  evaluateContractAssertion,
} = require('../openapi');

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Sibling-unique names, same rule as content.js: append " (copy)", " (copy) 2",
// ... case-insensitively.
function pickUniqueName(desired, usedNames) {
  const base = String(desired || '').trim() || 'Untitled';
  const taken = new Set(usedNames.map((name) => String(name).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const copy = `${base} (copy)`;
  if (!taken.has(copy.toLowerCase())) return copy;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${copy} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${copy} ${Date.now()}`;
}

async function projectOfCollection(collectionId) {
  const { rows } = await query(`SELECT project_id FROM collections WHERE id = $1`, [collectionId]);
  return rows[0]?.project_id || null;
}

async function projectOfRequest(requestId) {
  const { rows } = await query(
    `SELECT c.project_id FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0]?.project_id || null;
}

async function projectOfSpec(specId) {
  const { rows } = await query(`SELECT project_id FROM contract_specs WHERE id = $1`, [specId]);
  return rows[0]?.project_id || null;
}

async function canReadProject(userId, projectId) {
  return Boolean(await getProjectAccess(userId, projectId));
}

async function canWriteProject(userId, projectId) {
  const access = await getProjectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

function serializeSpec(row, extra = {}) {
  return {
    id: row.id,
    projectId: row.project_id,
    collectionId: row.collection_id ?? null,
    name: row.name,
    version: row.version ?? null,
    specHash: row.spec_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

async function specRow(specId) {
  const { rows } = await query(
    `SELECT id, project_id, collection_id, name, version, spec, spec_hash, created_by, created_at, updated_at
       FROM contract_specs WHERE id = $1`,
    [specId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------- list specs
router.get('/', async (req, res, next) => {
  try {
    const { projectId } = req.query;
    if (!isUuid(projectId)) return res.status(400).json({ error: 'projectId must be a valid uuid' });
    if (!(await canReadProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const { rows } = await query(
      `SELECT id, project_id, collection_id, name, version, spec, spec_hash, created_at, updated_at
         FROM contract_specs WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    const specs = rows.map((row) =>
      serializeSpec(row, { operationCount: collectOperations(row.spec).length })
    );
    res.json({ specs });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- import spec
router.post('/import', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { projectId } = body;
    const shouldGenerate = body.generateRequests !== false;
    if (!isUuid(projectId)) return res.status(400).json({ error: 'projectId must be a valid uuid' });
    if (!(await canWriteProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    let spec;
    try {
      spec = parseSpec(body.spec);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const name = String(body.name || spec.info.title || 'Imported API').trim();
    const generated = shouldGenerate ? generateRequests(spec, { collectionName: name }) : { collectionName: name, folders: [], requests: [] };

    let collection = null;
    if (body.collectionId) {
      if (!isUuid(body.collectionId)) return res.status(400).json({ error: 'collectionId must be a valid uuid' });
      const { rows } = await query(`SELECT id, name, project_id FROM collections WHERE id = $1`, [body.collectionId]);
      collection = rows[0] || null;
      if (!collection) return res.status(404).json({ error: 'Collection not found' });
      if (collection.project_id !== projectId) {
        return res.status(400).json({ error: 'Collection must belong to the target project' });
      }
    } else if (shouldGenerate) {
      const collectionGate = await checkCountGate({
        userId: req.user.id,
        orgId: await orgOfProject(projectId),
        key: 'collections',
        extra: 1,
      });
      if (collectionGate) return res.status(403).json(collectionGate);
      const { rows: existing } = await query(`SELECT name FROM collections WHERE project_id = $1`, [projectId]);
      const collectionName = pickUniqueName(generated.collectionName, existing.map((row) => row.name));
      const { rows } = await query(
        `INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id, name, project_id`,
        [projectId, collectionName]
      );
      collection = rows[0];
    }

    if (shouldGenerate && generated.requests.length) {
      const requestGate = await checkCountGate({
        userId: req.user.id,
        orgId: await orgOfProject(projectId),
        key: 'api_requests',
        extra: generated.requests.length,
      });
      if (requestGate) return res.status(403).json(requestGate);
    }

    const specHash = hashSpec(spec);
    const { rows: specRows } = await query(
      `INSERT INTO contract_specs (project_id, collection_id, name, version, spec, spec_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, project_id, collection_id, name, version, spec_hash, created_at, updated_at`,
      [
        projectId,
        collection ? collection.id : null,
        name,
        spec.info.version || null,
        JSON.stringify(spec),
        specHash,
        req.user.id,
      ]
    );

    const folders = [];
    const requests = [];
    if (collection && shouldGenerate) {
      const { rows: existingFolders } = await query(
        `SELECT name FROM folders WHERE collection_id = $1 AND parent_id IS NULL`,
        [collection.id]
      );
      const usedFolderNames = existingFolders.map((row) => row.name);
      const folderIds = new Map();
      for (const folder of generated.folders) {
        const folderName = pickUniqueName(folder.name, usedFolderNames);
        usedFolderNames.push(folderName);
        const { rows } = await query(
          `INSERT INTO folders (collection_id, name, parent_id) VALUES ($1, $2, NULL)
           RETURNING id, name, collection_id, parent_id`,
          [collection.id, folderName]
        );
        folderIds.set(folder.name, rows[0].id);
        folders.push(rows[0]);
      }

      const usedByFolder = new Map();
      for (const req of generated.requests) {
        const folderId = folderIds.get(req.folder) || null;
        const key = folderId || '';
        if (!usedByFolder.has(key)) {
          const { rows } = await query(
            `SELECT name FROM api_requests WHERE collection_id = $1 AND folder_id IS NOT DISTINCT FROM $2`,
            [collection.id, folderId]
          );
          usedByFolder.set(key, rows.map((row) => row.name));
        }
        const used = usedByFolder.get(key);
        const requestName = pickUniqueName(req.name, used);
        used.push(requestName);
        const { rows } = await query(
          `INSERT INTO api_requests
             (collection_id, name, method, url, api_type, headers, query_params, body_type, body_json, assertions, folder_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, name, method, url, api_type, collection_id, folder_id`,
          [
            collection.id,
            requestName,
            req.method,
            req.url,
            req.apiType,
            JSON.stringify([]),
            JSON.stringify([]),
            req.bodyType,
            req.bodyJson === null ? null : JSON.stringify(req.bodyJson),
            JSON.stringify([]),
            folderId,
          ]
        );
        requests.push(rows[0]);
      }
    }

    res.status(201).json({
      spec: serializeSpec(specRows[0], { operationCount: collectOperations(spec).length }),
      collection,
      folders,
      requests,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- diff specs
router.post('/diff', async (req, res, next) => {
  try {
    const body = req.body || {};
    let baseSpec = body.base;
    let headSpec = body.head;
    let baseMeta = null;
    let headMeta = null;

    if (body.baseSpecId || body.headSpecId) {
      if (!isUuid(body.baseSpecId) || !isUuid(body.headSpecId)) {
        return res.status(400).json({ error: 'baseSpecId and headSpecId must be valid uuids' });
      }
      const baseRow = await specRow(body.baseSpecId);
      const headRow = await specRow(body.headSpecId);
      if (!baseRow || !headRow) return res.status(404).json({ error: 'Spec not found' });
      if (!(await canReadProject(req.user.id, baseRow.project_id)) || !(await canReadProject(req.user.id, headRow.project_id))) {
        return res.status(403).json({ error: 'No access to one of these specs' });
      }
      baseSpec = baseRow.spec;
      headSpec = headRow.spec;
      baseMeta = serializeSpec(baseRow);
      headMeta = serializeSpec(headRow);
    }

    try {
      baseSpec = parseSpec(baseSpec);
      headSpec = parseSpec(headSpec);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    res.json({ diff: diffSpecs(baseSpec, headSpec), base: baseMeta, head: headMeta });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------ validate response
router.post('/validate', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!isUuid(body.specId)) return res.status(400).json({ error: 'specId must be a valid uuid' });
    const row = await specRow(body.specId);
    if (!row) return res.status(404).json({ error: 'Spec not found' });
    if (!(await canReadProject(req.user.id, row.project_id))) {
      return res.status(403).json({ error: 'No access to this spec' });
    }
    const method = normalizeMethod(body.method);
    if (!method) return res.status(400).json({ error: 'method must be a valid HTTP verb' });
    const response = body.response || {};
    const result = validateResponse(row.spec, normalizedTarget(method, body), response);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

function normalizedTarget(method, body) {
  return {
    method,
    path: normalizePath(body.path),
    statusCode: body.statusCode !== undefined && body.statusCode !== null && body.statusCode !== ''
      ? normalizeStatusCode(body.statusCode)
      : undefined,
  };
}

// ---------------------------------------------------------- request contracts
router.get('/checks', async (req, res, next) => {
  try {
    const { requestId } = req.query;
    if (!isUuid(requestId)) return res.status(400).json({ error: 'requestId must be a valid uuid' });
    const projectId = await projectOfRequest(requestId);
    if (!projectId) return res.status(404).json({ error: 'Request not found' });
    if (!(await canReadProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'No access to this request' });
    }
    const { rows } = await query(
      `SELECT cc.id, cc.request_id, cc.spec_id, cc.method, cc.path, cc.status_code, cc.created_at,
              cs.name AS spec_name, cs.version AS spec_version
         FROM contract_checks cc
         JOIN contract_specs cs ON cs.id = cc.spec_id
        WHERE cc.request_id = $1
        ORDER BY cc.created_at`,
      [requestId]
    );
    res.json({
      checks: rows.map((row) => ({
        id: row.id,
        requestId: row.request_id,
        specId: row.spec_id,
        specName: row.spec_name,
        specVersion: row.spec_version ?? null,
        method: row.method,
        path: row.path,
        statusCode: row.status_code,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/checks', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { requestId, specId } = body;
    if (!isUuid(requestId) || !isUuid(specId)) {
      return res.status(400).json({ error: 'requestId and specId must be valid uuids' });
    }
    const requestProject = await projectOfRequest(requestId);
    if (!requestProject) return res.status(404).json({ error: 'Request not found' });
    if (!(await canWriteProject(req.user.id, requestProject))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const spec = await specRow(specId);
    if (!spec) return res.status(404).json({ error: 'Spec not found' });
    if (spec.project_id !== requestProject) {
      return res.status(400).json({ error: 'Spec and request must belong to the same project' });
    }
    const method = normalizeMethod(body.method);
    if (!method) return res.status(400).json({ error: 'method must be a valid HTTP verb' });
    const path = normalizePath(body.path);
    const statusCode = normalizeStatusCode(body.statusCode);
    const operation = getResponseSchema(spec.spec, method, path, statusCode);
    if (!operation) {
      return res.status(400).json({ error: `No JSON response schema for ${method.toUpperCase()} ${path} (${statusCode})` });
    }
    const { rows } = await query(
      `INSERT INTO contract_checks (request_id, spec_id, method, path, status_code)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (request_id, spec_id, method, path, status_code)
       DO UPDATE SET created_at = now()
       RETURNING id, request_id, spec_id, method, path, status_code, created_at`,
      [requestId, specId, method.toUpperCase(), path, statusCode]
    );
    res.status(201).json({ check: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/checks/:checkId', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT request_id FROM contract_checks WHERE id = $1`, [req.params.checkId]);
    if (!rows.length) return res.status(404).json({ error: 'Contract check not found' });
    const projectId = await projectOfRequest(rows[0].request_id);
    if (!projectId || !(await canWriteProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await query(`DELETE FROM contract_checks WHERE id = $1`, [req.params.checkId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Evaluate every attached contract check against a live response body. Result
// entries match the engine's assertion result shape ({ id, passed, message }).
router.post('/validate-request', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { requestId } = body;
    if (!isUuid(requestId)) return res.status(400).json({ error: 'requestId must be a valid uuid' });
    const projectId = await projectOfRequest(requestId);
    if (!projectId) return res.status(404).json({ error: 'Request not found' });
    if (!(await canReadProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'No access to this request' });
    }
    const { rows } = await query(
      `SELECT cc.id, cc.method, cc.path, cc.status_code, cs.spec
         FROM contract_checks cc
         JOIN contract_specs cs ON cs.id = cc.spec_id
        WHERE cc.request_id = $1
        ORDER BY cc.created_at`,
      [requestId]
    );
    const response = body.response || {};
    const results = rows.map((row) => {
      const assertion = { id: row.id, method: row.method, path: row.path, statusCode: row.status_code };
      return evaluateContractAssertion(row.spec, assertion, response);
    });
    res.json({ passed: results.length > 0 && results.every((result) => result.passed), results });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- spec detail
router.get('/:specId/operations', async (req, res, next) => {
  try {
    const row = await specRow(req.params.specId);
    if (!row) return res.status(404).json({ error: 'Spec not found' });
    if (!(await canReadProject(req.user.id, row.project_id))) {
      return res.status(403).json({ error: 'No access to this spec' });
    }
    res.json({ spec: serializeSpec(row), operations: collectOperations(row.spec) });
  } catch (err) {
    next(err);
  }
});

router.get('/:specId', async (req, res, next) => {
  try {
    const row = await specRow(req.params.specId);
    if (!row) return res.status(404).json({ error: 'Spec not found' });
    if (!(await canReadProject(req.user.id, row.project_id))) {
      return res.status(403).json({ error: 'No access to this spec' });
    }
    res.json({
      spec: serializeSpec(row, { document: row.spec }),
      operations: collectOperations(row.spec),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
