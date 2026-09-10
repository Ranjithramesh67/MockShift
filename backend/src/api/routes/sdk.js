'use strict';

// Round 5 — apihub-sdk route sync.
//   POST /api/sdk/sync  (Bearer token, scope "sdk" or "write")
//
// The SDK sends a manifest of folders + requests. We resolve the target
// project/collection, then upsert folders and requests by external_key so
// repeated syncs update in place. Access + plan gates mirror contracts.js.

const { Router } = require('express');
const { query, pool } = require('../db');
const { tokenAuth } = require('../tokenAuth');
const { getProjectAccess, roleAtLeast, canMutateWorkspace } = require('../access');
const { checkCountGate, orgOfProject } = require('../entitlements');
const { normalizeManifest, pickUniqueName } = require('../sdkManifest');

const router = Router();
router.use(tokenAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

async function projectRow(projectId) {
  const { rows } = await query(
    `SELECT p.id, p.name, p.workspace_id FROM projects p WHERE p.id = $1`,
    [projectId]
  );
  return rows[0] || null;
}

async function resolveProject(req, manifest) {
  const token = req.apiToken;
  let project = null;

  if (token.project_id) {
    project = await projectRow(token.project_id);
    if (!project) return { error: { status: 403, body: { error: 'Bound project no longer exists' } } };
    const access = await getProjectAccess(req.user.id, project.id);
    if (!access || !roleAtLeast(access.level, 'EDITOR')) {
      return { error: { status: 403, body: { error: 'Editor, manager or admin access required' } } };
    }
    return { project };
  }

  if (token.workspace_id) {
    const workspace = (await query(`SELECT id FROM workspaces WHERE id = $1`, [token.workspace_id])).rows[0];
    if (!workspace) return { error: { status: 403, body: { error: 'Bound workspace no longer exists' } } };
    if (!(await canMutateWorkspace(req.user.id, workspace.id))) {
      return { error: { status: 403, body: { error: 'Workspace write access required' } } };
    }
    const name = manifest.project || 'SDK Sync';
    const existing = (await query(
      `SELECT id, name, workspace_id FROM projects WHERE workspace_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
      [workspace.id, name]
    )).rows[0];
    if (existing) return { project: existing };
    const created = (await query(
      `INSERT INTO projects (workspace_id, name) VALUES ($1, $2) RETURNING id, name, workspace_id`,
      [workspace.id, name]
    )).rows[0];
    return { project: created };
  }

  // Unbound (legacy personal) token: require an explicit project the user owns.
  const projectId = manifest.projectId;
  if (!isUuid(projectId)) {
    return { error: { status: 400, body: { error: 'Provide projectId, or use a project/workspace-bound key' } } };
  }
  project = await projectRow(projectId);
  if (!project) return { error: { status: 404, body: { error: 'Project not found' } } };
  const access = await getProjectAccess(req.user.id, project.id);
  if (!access || !roleAtLeast(access.level, 'EDITOR')) {
    return { error: { status: 403, body: { error: 'Editor, manager or admin access required' } } };
  }
  return { project };
}

async function resolveCollection(req, project, manifest, summary, exec) {
  const name = manifest.collection || project.name;
  const existing = (await exec(
    `SELECT id, name FROM collections WHERE project_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
    [project.id, name]
  )).rows[0];
  if (existing) {
    await exec(`UPDATE collections SET source = COALESCE(source, $2) WHERE id = $1`, [existing.id, manifest.source]);
    return existing;
  }
  const gate = await checkCountGate({ userId: req.user.id, orgId: await orgOfProject(project.id), key: 'collections' });
  if (gate) return { error: { status: 403, body: gate } };
  const used = (await exec(`SELECT name FROM collections WHERE project_id = $1`, [project.id])).rows.map((r) => r.name);
  const collection = (await exec(
    `INSERT INTO collections (project_id, name, source) VALUES ($1, $2, $3) RETURNING id, name`,
    [project.id, pickUniqueName(name, used), manifest.source]
  )).rows[0];
  summary.collections.created += 1;
  return collection;
}

async function upsertFolders(req, collection, manifest, summary, exec) {
  const idByKey = new Map();
  for (const folder of manifest.folders) {
    const parentId = folder.parent ? idByKey.get(folder.parent) || null : null;
    const existing = (await exec(
      `SELECT id, name, parent_id FROM folders WHERE collection_id = $1 AND external_key = $2`,
      [collection.id, folder.key]
    )).rows[0];
    if (existing) {
      if (existing.name !== folder.name || existing.parent_id !== parentId) {
        const siblings = (await exec(
          `SELECT name FROM folders WHERE collection_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND id <> $3`,
          [collection.id, parentId, existing.id]
        )).rows.map((r) => r.name);
        await exec(
          `UPDATE folders SET name = $2, parent_id = $3, source = COALESCE(source, $4) WHERE id = $1`,
          [existing.id, pickUniqueName(folder.name, siblings), parentId, manifest.source]
        );
        summary.folders.updated += 1;
      }
      idByKey.set(folder.key, existing.id);
      continue;
    }
    const siblings = (await exec(
      `SELECT name FROM folders WHERE collection_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
      [collection.id, parentId]
    )).rows.map((r) => r.name);
    const created = (await exec(
      `INSERT INTO folders (collection_id, name, parent_id, external_key, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [collection.id, pickUniqueName(folder.name, siblings), parentId, folder.key, manifest.source]
    )).rows[0];
    idByKey.set(folder.key, created.id);
    summary.folders.created += 1;
  }
  return idByKey;
}

async function upsertRequests(req, collection, manifest, folderIdByKey, summary, exec) {
  const seenKeys = [];
  const created = [];
  const updated = [];
  for (const r of manifest.requests) {
    const folderId = r.folder ? folderIdByKey.get(r.folder) || null : null;
    seenKeys.push(r.key);
    const existing = (await exec(
      `SELECT id FROM api_requests WHERE collection_id = $1 AND external_key = $2`,
      [collection.id, r.key]
    )).rows[0];

    if (existing) {
      await exec(
        `UPDATE api_requests
            SET name = $2, method = $3, url = $4, api_type = $5, headers = $6, query_params = $7,
                body_type = $8, body_json = $9, body_text = $10, assertions = $11, folder_id = $12,
                source = $13, source_file = $14, synced_at = now()
          WHERE id = $1`,
        [
          existing.id, r.name, r.method, r.url, r.apiType,
          JSON.stringify(r.headers), JSON.stringify(r.queryParams),
          r.bodyType, r.bodyJson === null ? null : JSON.stringify(r.bodyJson), r.bodyText,
          JSON.stringify(r.assertions), folderId,
          r.source || manifest.source, r.sourceFile,
        ]
      );
      updated.push(existing.id);
      summary.requests.updated += 1;
      continue;
    }

    const gate = await checkCountGate({
      userId: req.user.id, orgId: await orgOfProject(collection.project_id || (await exec(
        `SELECT project_id FROM collections WHERE id = $1`, [collection.id]
      )).rows[0].project_id), key: 'api_requests', extra: 1,
    });
    if (gate) return { error: { status: 403, body: gate } };

    const siblings = (await exec(
      `SELECT name FROM api_requests WHERE collection_id = $1 AND folder_id IS NOT DISTINCT FROM $2`,
      [collection.id, folderId]
    )).rows.map((row) => row.name);
    const inserted = (await exec(
      `INSERT INTO api_requests
         (collection_id, name, method, url, api_type, headers, query_params, body_type,
          body_json, body_text, assertions, folder_id, external_key, source, source_file, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       RETURNING id`,
      [
        collection.id, pickUniqueName(r.name, siblings), r.method, r.url, r.apiType,
        JSON.stringify(r.headers), JSON.stringify(r.queryParams), r.bodyType,
        r.bodyJson === null ? null : JSON.stringify(r.bodyJson), r.bodyText,
        JSON.stringify(r.assertions), folderId, r.key, r.source || manifest.source, r.sourceFile,
      ]
    )).rows[0];
    created.push(inserted.id);
    summary.requests.created += 1;
  }

  if (manifest.prune) {
    const { rows } = await exec(
      `DELETE FROM api_requests
        WHERE collection_id = $1 AND external_key IS NOT NULL AND source = $2
          AND NOT (external_key = ANY($3::text[]))
        RETURNING id`,
      [collection.id, manifest.source, seenKeys]
    );
    summary.requests.pruned += rows.length;
  }
  return { created, updated };
}

router.post('/sync', async (req, res, next) => {
  const client = await pool.connect();
  const exec = (text, params) => client.query(text, params);
  try {
    if (!req.apiToken.scopes.includes('sdk') && !req.apiToken.scopes.includes('write')) {
      return res.status(403).json({ error: 'API token requires the "sdk" or "write" scope' });
    }
    let manifest;
    try {
      manifest = normalizeManifest(req.body || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const resolved = await resolveProject(req, manifest);
    if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);
    const { project } = resolved;
    project.name = project.name || '';

    const summary = {
      collectionId: null,
      collections: { created: 0 },
      folders: { created: 0, updated: 0 },
      requests: { created: 0, updated: 0, pruned: 0 },
    };

    await client.query('BEGIN');
    const collectionResult = await resolveCollection(req, project, manifest, summary, exec);
    if (collectionResult.error) {
      await client.query('ROLLBACK');
      return res.status(collectionResult.error.status).json(collectionResult.error.body);
    }
    const collection = collectionResult;
    collection.project_id = project.id;
    summary.collectionId = collection.id;

    const folderIdByKey = await upsertFolders(req, collection, manifest, summary, exec);
    const reqResult = await upsertRequests(req, collection, manifest, folderIdByKey, summary, exec);
    if (reqResult.error) {
      await client.query('ROLLBACK');
      return res.status(reqResult.error.status).json(reqResult.error.body);
    }

    await client.query(
      `INSERT INTO sdk_sync_runs (token_id, user_id, workspace_id, project_id, collection_id, source, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.apiToken.id, req.user.id, project.workspace_id, project.id, collection.id, manifest.source, JSON.stringify(summary)]
    );
    await client.query('COMMIT');

    res.status(201).json({
      summary,
      projectId: project.id,
      collectionId: collection.id,
      requestIds: reqResult.created.concat(reqResult.updated),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
