'use strict';

// ============================================================================
// Sends — send an item (request / folder / collection / project / workspace)
// to another user. Mirrors the request_shares (shares.js) and notifications
// (notifications.js) conventions: every handler is auth-gated with requireAuth
// and talks to Postgres through the ../db.js `query` helper.
//
// Lifecycle:
//   POST  /api/sends                       (sender)      create a send: the
//     recipient is validated (must exist, must not be the sender) and the item
//     ownership is checked against the workspace/project RBAC before a row with
//     status 'pending' is inserted. A notification is written for the
//     recipient.
//   GET   /api/sends/inbox                 (recipient)   sends addressed to the
//     caller. Defaults to status='pending'; pass ?status= to also see
//     accepted/rejected responses.
//   GET   /api/sends/outbox                (sender)      sends the caller
//     created, newest first.
//   GET   /api/sends/recipients            (any)         candidate recipients:
//     active users sharing an org or a workspace with the caller.
//   POST  /api/sends/:sendId/accept        (recipient)   clones the item into
//     the recipient's own account/workspace (a "(copy)" name suffix is used on
//     name clash), stores where the copy landed in accepted_path, and flips the
//     row to status='accepted' with responded_at set. The sender keeps the
//     original. The sender is notified of the outcome.
//   POST  /api/sends/:sendId/reject        (recipient)   flips the row to
//     status='rejected' with responded_at set. The sender is notified.
//
// A send is only ever visible/mutable by its sender and its recipient; callers
// who are neither get a 404 (so existence is not leaked). Accept/reject are
// one-way: a responded send (accepted/rejected) cannot be responded to again.
// accepted_path only exists on accepted sends and is recipient-scoped.
// ============================================================================

const { Router } = require('express');
const { query, pool } = require('../db');
const { requireAuth, roleAtLeast, getWorkspaceRole, getProjectAccess } = require('../access');
const { logAudit } = require('../audit');

const router = Router();
router.use(requireAuth);

const ITEM_TYPES = ['request', 'folder', 'collection', 'project', 'workspace'];
const STATUSES = ['pending', 'accepted', 'rejected'];
const ITEM_TABLE = {
  request: 'api_requests',
  folder: 'folders',
  collection: 'collections',
  project: 'projects',
  workspace: 'workspaces',
};

// ---------------------------------------------------------------- Utilities

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// Case-insensitive sibling-unique names ("X (copy)", "X (copy) 2", ...).
function pickUniqueName(desired, usedNames) {
  const base = String(desired || '').trim();
  const taken = new Set(usedNames.map((n) => String(n).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const copy = `${base} (copy)`;
  if (!taken.has(copy.toLowerCase())) return copy;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${copy} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${copy} ${Date.now()}`;
}

async function uniqueName(exec, baseName, table, whereSql, params) {
  const { rows } = await exec(`SELECT name FROM ${table} WHERE ${whereSql}`, params);
  return pickUniqueName(baseName, rows.map((r) => r.name));
}

async function uniqueProjectName(exec, workspaceId, desired) {
  return uniqueName(exec, desired, 'projects', 'workspace_id = $1', [workspaceId]);
}

async function uniqueCollectionName(exec, projectId, desired) {
  return uniqueName(exec, desired, 'collections', 'project_id = $1', [projectId]);
}

async function uniqueFolderName(exec, collectionId, parentId, desired) {
  return uniqueName(
    exec,
    desired,
    'folders',
    'collection_id = $1 AND parent_id IS NOT DISTINCT FROM $2',
    [collectionId, parentId || null]
  );
}

async function uniqueRequestName(exec, collectionId, folderId, desired) {
  return uniqueName(
    exec,
    desired,
    'api_requests',
    'collection_id = $1 AND folder_id IS NOT DISTINCT FROM $2',
    [collectionId, folderId || null]
  );
}

async function uniqueWorkspaceName(exec, organizationId, desired) {
  return uniqueName(exec, desired, 'workspaces', 'organization_id = $1', [organizationId]);
}

async function workspaceRow(workspaceId) {
  const { rows } = await query(
    `SELECT id, name, organization_id FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  return rows[0] || null;
}

async function projectRow(projectId) {
  const { rows } = await query(`SELECT id, name, workspace_id FROM projects WHERE id = $1`, [projectId]);
  return rows[0] || null;
}

async function collectionRow(collectionId) {
  const { rows } = await query(`SELECT id, name, project_id FROM collections WHERE id = $1`, [collectionId]);
  return rows[0] || null;
}

async function requestRow(requestId) {
  const { rows } = await query(
    `SELECT id, collection_id, name, method, url, headers, query_params, body_type, body_json,
            body_text, body_parts, api_type, formula, assertions, folder_id
       FROM api_requests WHERE id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

async function folderRow(folderId) {
  const { rows } = await query(
    `SELECT id, collection_id, name, parent_id FROM folders WHERE id = $1`,
    [folderId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------- Ownership checks
// The sender must "own" the item being sent, mirroring how shares.js/content.js
// gate write access: workspace -> owner/manager membership; project -> org
// membership via its workspace (manager+/org-admin access); collection/folder/
// request -> edit access to the owning workspace/project.

async function itemForSend(itemType, itemId) {
  if (!ITEM_TYPES.includes(itemType)) {
    return { status: 400, error: 'itemType must be one of: request, folder, collection, project, workspace' };
  }
  if (itemType === 'workspace') {
    const ws = await workspaceRow(itemId);
    if (!ws) return { status: 404, error: 'Workspace not found' };
    return { item: { id: ws.id, name: ws.name, type: itemType, workspaceId: ws.id, workspaceName: ws.name } };
  }
  if (itemType === 'project') {
    const project = await projectRow(itemId);
    if (!project) return { status: 404, error: 'Project not found' };
    const ws = await workspaceRow(project.workspace_id);
    return {
      item: {
        id: project.id,
        name: project.name,
        type: itemType,
        workspaceId: project.workspace_id,
        workspaceName: ws?.name ?? null,
      },
    };
  }
  if (itemType === 'collection') {
    const collection = await collectionRow(itemId);
    if (!collection) return { status: 404, error: 'Collection not found' };
    const project = await projectRow(collection.project_id);
    const ws = project ? await workspaceRow(project.workspace_id) : null;
    return {
      item: {
        id: collection.id,
        name: collection.name,
        type: itemType,
        projectId: collection.project_id,
        projectName: project?.name ?? null,
        workspaceId: project?.workspace_id ?? null,
        workspaceName: ws?.name ?? null,
      },
    };
  }
  if (itemType === 'folder') {
    const folder = await folderRow(itemId);
    if (!folder) return { status: 404, error: 'Folder not found' };
    const collection = await collectionRow(folder.collection_id);
    const project = collection ? await projectRow(collection.project_id) : null;
    const ws = project ? await workspaceRow(project.workspace_id) : null;
    return {
      item: {
        id: folder.id,
        name: folder.name,
        type: itemType,
        collectionId: folder.collection_id,
        collectionName: collection?.name ?? null,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        workspaceId: project?.workspace_id ?? null,
        workspaceName: ws?.name ?? null,
      },
    };
  }
  // request
  const req = await requestRow(itemId);
  if (!req) return { status: 404, error: 'Request not found' };
  const collection = await collectionRow(req.collection_id);
  const project = collection ? await projectRow(collection.project_id) : null;
  const ws = project ? await workspaceRow(project.workspace_id) : null;
  let folder = null;
  if (req.folder_id) {
    folder = await folderRow(req.folder_id);
    if (folder) {
      const { rows } = await query(
        `SELECT name FROM folders WHERE id = $1`,
        [folder.parent_id]
      );
      folder.parentName = rows[0]?.name ?? null;
    }
  }
  return {
    item: {
      id: req.id,
      name: req.name,
      type: itemType,
      collectionId: req.collection_id,
      collectionName: collection?.name ?? null,
      folderId: req.folder_id ?? null,
      folderName: folder?.name ?? null,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      workspaceId: project?.workspace_id ?? null,
      workspaceName: ws?.name ?? null,
    },
  };
}

async function senderOwnsItem(userId, item) {
  if (item.type === 'workspace') {
    const role = await getWorkspaceRole(userId, item.workspaceId);
    if (!roleAtLeast(role, 'MANAGER')) {
      return { status: 403, error: 'Only workspace owners or managers can send a workspace' };
    }
    return { ok: true };
  }
  if (item.type === 'project') {
    const access = await getProjectAccess(userId, item.id);
    if (!access || !roleAtLeast(access.level, 'MANAGER')) {
      return { status: 403, error: 'Manager, owner or admin access required' };
    }
    return { ok: true };
  }
  // request / folder / collection — edit access to the owning project.
  const access = item.projectId ? await getProjectAccess(userId, item.projectId) : null;
  if (!access || !roleAtLeast(access.level, 'EDITOR')) {
    return { status: 403, error: 'Editor, manager or admin access required' };
  }
  return { ok: true };
}

// --------------------------------------------------- Recipient target helpers
// Where accepted content lands: a workspace the recipient can write to. When
// the recipient is an editor+ member of the sender's workspace the copy can
// live next to the original (same workspace); otherwise a recipient-owned
// "default" workspace is chosen, created on the fly when the recipient has none
// writable (an org is created too when they have no org at all).

async function recipientAdminOrg(client, recipientId) {
  const { rows } = await client.query(
    `SELECT o.id, o.name
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id AND om.user_id = $1 AND om.role = 'ADMIN'
      ORDER BY o.id
      LIMIT 1`,
    [recipientId]
  );
  return rows[0] || null;
}

async function recipientWritableWorkspaces(recipientId) {
  const { rows } = await query(
    `SELECT w.id, w.name, w.organization_id
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
       JOIN users u ON u.id = $1
      WHERE u.is_active = true
      ORDER BY w.id`,
    [recipientId]
  );
  const writable = [];
  for (const ws of rows) {
    const role = await getWorkspaceRole(recipientId, ws.id);
    if (roleAtLeast(role, 'EDITOR')) writable.push(ws);
  }
  return writable;
}

async function ensureRecipientDefaultWorkspace(client, recipientId, recipientName) {
  const writable = await recipientWritableWorkspaces(recipientId);
  if (writable.length > 0) {
    const mine = writable.find((w) => w.name === 'My Workspace');
    return mine || writable[0];
  }
  // No writable workspace: create one inside an org the recipient administers,
  // falling back to a brand-new org owned by the recipient.
  let org = await recipientAdminOrg(client, recipientId);
  if (!org) {
    const display = (recipientName || 'User').trim();
    const { rows } = await client.query(
      `INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING id, name`,
      [`${display}'s Org`, recipientId]
    );
    org = rows[0];
    await client.query(
      `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
      [org.id, recipientId]
    );
  }
  const wsName = await uniqueWorkspaceName(client.query.bind(client), org.id, 'My Workspace');
  const { rows } = await client.query(
    `INSERT INTO workspaces (organization_id, name, visibility) VALUES ($1, $2, 'PRIVATE') RETURNING id, name, organization_id`,
    [org.id, wsName]
  );
  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
    [rows[0].id, recipientId]
  );
  return rows[0];
}

async function chooseTargetWorkspace(client, recipientId, recipientName, sourceWorkspaceId) {
  if (sourceWorkspaceId) {
    const role = await getWorkspaceRole(recipientId, sourceWorkspaceId);
    if (roleAtLeast(role, 'EDITOR')) return workspaceRow(sourceWorkspaceId);
  }
  return ensureRecipientDefaultWorkspace(client, recipientId, recipientName);
}

async function recipientName(client, recipientId) {
  const { rows } = await client.query(`SELECT name FROM users WHERE id = $1`, [recipientId]);
  return rows[0]?.name || null;
}

// ----------------------------------------------------------- Clone primitives
// Deep-copy helpers run inside the caller's transaction (exec = client.query).
// Every created object gets a sibling-unique name, so an existing name never
// collides: the accepted copy appends " (copy)" and re-parents to the fresh ids.

async function insertProject(exec, workspaceId, name) {
  const finalName = await uniqueProjectName(exec, workspaceId, name);
  const { rows } = await exec(
    `INSERT INTO projects (workspace_id, name) VALUES ($1, $2) RETURNING id, name, workspace_id`,
    [workspaceId, finalName]
  );
  return rows[0];
}

async function insertCollection(exec, projectId, name) {
  const finalName = await uniqueCollectionName(exec, projectId, name);
  const { rows } = await exec(
    `INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id, name, project_id`,
    [projectId, finalName]
  );
  return rows[0];
}

async function insertFolder(exec, collectionId, parentId, name) {
  const finalName = await uniqueFolderName(exec, collectionId, parentId, name);
  const { rows } = await exec(
    `INSERT INTO folders (collection_id, name, parent_id) VALUES ($1, $2, $3) RETURNING id, name, collection_id, parent_id`,
    [collectionId, finalName, parentId || null]
  );
  return rows[0];
}

async function insertRequest(exec, source, collectionId, folderId, name) {
  const finalName = await uniqueRequestName(exec, collectionId, folderId || null, name || source.name);
  const { rows } = await exec(
    `INSERT INTO api_requests
       (collection_id, name, method, url, api_type, headers, query_params, body_type,
        body_json, body_text, body_parts, formula, assertions, folder_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id, name, collection_id, folder_id`,
    [
      collectionId,
      finalName,
      source.method,
      source.url,
      source.api_type,
      JSON.stringify(source.headers || []),
      JSON.stringify(source.query_params || []),
      source.body_type,
      source.body_json ?? null,
      source.body_text ?? null,
      source.body_parts ? JSON.stringify(source.body_parts) : null,
      source.formula || '',
      JSON.stringify(source.assertions || []),
      folderId || null,
    ]
  );
  return rows[0];
}

// Copy the full folder tree + requests of one source collection into an already
// created target collection, re-parenting copies to the fresh folder ids.
async function copyCollectionContent(exec, sourceCollectionId, targetCollectionId) {
  const { rows: folders } = await exec(
    `SELECT id, name, parent_id FROM folders WHERE collection_id = $1 ORDER BY name`,
    [sourceCollectionId]
  );
  const idMap = new Map();
  const byParent = new Map();
  for (const f of folders) {
    const key = f.parent_id || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const queue = [...(byParent.get(null) || [])];
  const seen = new Set();
  while (queue.length) {
    const folder = queue.shift();
    if (seen.has(folder.id)) continue;
    seen.add(folder.id);
    const copy = await insertFolder(
      exec,
      targetCollectionId,
      folder.parent_id ? idMap.get(folder.parent_id) || null : null,
      folder.name
    );
    idMap.set(folder.id, copy.id);
    for (const child of byParent.get(folder.id) || []) queue.push(child);
  }

  const { rows: requests } = await exec(
    `SELECT id, name, method, url, headers, query_params, body_type, body_json, body_text,
            body_parts, api_type, formula, assertions, collection_id, folder_id
       FROM api_requests WHERE collection_id = $1 ORDER BY name`,
    [sourceCollectionId]
  );
  for (const req of requests) {
    await insertRequest(
      exec,
      req,
      targetCollectionId,
      req.folder_id ? idMap.get(req.folder_id) || null : null,
      req.name
    );
  }
}

// Copy every collection (with folders + requests) of a source project into a
// target project.
async function copyProjectContent(exec, sourceProjectId, targetProjectId) {
  const { rows: collections } = await exec(
    `SELECT id, name FROM collections WHERE project_id = $1 ORDER BY name`,
    [sourceProjectId]
  );
  for (const collection of collections) {
    const copy = await insertCollection(exec, targetProjectId, collection.name);
    await copyCollectionContent(exec, collection.id, copy.id);
  }
}

// Rebuild the ancestor chain of a source folder as fresh (uniquified) folder
// shells inside targetCollectionId so a lone request keeps its folder context.
async function copyFolderAncestry(exec, sourceFolderId, targetCollectionId) {
  const { rows } = await exec(`SELECT id, name, parent_id FROM folders WHERE id = $1`, [sourceFolderId]);
  const leaf = rows[0];
  if (!leaf) return null;
  const chain = [];
  let current = leaf;
  let guard = 0;
  while (current && guard < 50) {
    chain.unshift(current);
    guard += 1;
    if (!current.parent_id) break;
    const { rows: parents } = await exec(`SELECT id, name, parent_id FROM folders WHERE id = $1`, [current.parent_id]);
    current = parents[0] || null;
  }
  let parentCopyId = null;
  let deepest = null;
  for (const folder of chain) {
    deepest = await insertFolder(exec, targetCollectionId, parentCopyId, folder.name);
    parentCopyId = deepest.id;
  }
  return deepest;
}

// Deep-copy a single folder subtree (sourceFolderId and all descendants) into a
// target collection, re-parenting copies to the fresh ids.
async function copyFolderSubtree(exec, sourceFolder, targetCollectionId) {
  const { rows: allFolders } = await exec(
    `SELECT id, name, parent_id, collection_id FROM folders WHERE collection_id = $1`,
    [sourceFolder.collection_id]
  );
  const byParent = new Map();
  for (const f of allFolders) {
    const key = f.parent_id || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const subtree = [];
  const seen = new Set([sourceFolder.id]);
  const queue = [sourceFolder];
  while (queue.length) {
    const current = queue.shift();
    subtree.push(current);
    for (const child of byParent.get(current.id) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child);
    }
  }

  const idMap = new Map();
  let rootCopy = null;
  for (const folder of subtree) {
    const isRoot = folder.id === sourceFolder.id;
    const newParentId = isRoot ? null : idMap.get(folder.parent_id) || null;
    const copy = await insertFolder(exec, targetCollectionId, newParentId, folder.name);
    if (isRoot) rootCopy = copy;
    idMap.set(folder.id, copy.id);
  }

  const { rows: requests } = await exec(
    `SELECT id, name, method, url, headers, query_params, body_type, body_json, body_text,
            body_parts, api_type, formula, assertions, collection_id, folder_id
       FROM api_requests WHERE folder_id = ANY($1::uuid[])`,
    [[...seen]]
  );
  for (const req of requests) {
    await insertRequest(exec, req, targetCollectionId, idMap.get(req.folder_id) || null, req.name);
  }
  return rootCopy;
}

// ------------------------------------------------------------ Clone pipeline
// Each clone returns the recipient-scoped accepted_path describing where the
// copy landed.

async function cloneWorkspaceFor(exec, client, recipientId, sourceWorkspaceId, item) {
  const recipient = await recipientName(client, recipientId);
  // The workspace copy always lives in an org the recipient administers.
  let org = await recipientAdminOrg(client, recipientId);
  if (!org) {
    const { rows } = await client.query(
      `INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING id, name`,
      [`${(recipient || 'User')}'s Org`, recipientId]
    );
    org = rows[0];
    await client.query(
      `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
      [org.id, recipientId]
    );
  }
  const wsName = await uniqueWorkspaceName(exec, org.id, item.name || 'Workspace');
  const { rows } = await client.query(
    `INSERT INTO workspaces (organization_id, name, visibility) VALUES ($1, $2, 'PRIVATE') RETURNING id, name, organization_id`,
    [org.id, wsName]
  );
  const targetWorkspace = rows[0];
  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
    [targetWorkspace.id, recipientId]
  );
  await copyAllProjects(exec, sourceWorkspaceId, targetWorkspace.id);
  return {
    type: 'workspace',
    name: targetWorkspace.name,
    workspaceId: targetWorkspace.id,
    workspaceName: targetWorkspace.name,
  };
}

async function copyAllProjects(exec, sourceWorkspaceId, targetWorkspaceId) {
  const { rows: projects } = await exec(
    `SELECT id, name FROM projects WHERE workspace_id = $1 ORDER BY name`,
    [sourceWorkspaceId]
  );
  for (const project of projects) {
    const copy = await insertProject(exec, targetWorkspaceId, project.name);
    await copyProjectContent(exec, project.id, copy.id);
  }
}

async function cloneProjectFor(exec, client, recipientId, sourceProjectId) {
  const source = await projectRow(sourceProjectId);
  const targetWs = await chooseTargetWorkspace(
    exec,
    recipientId,
    await recipientName(client, recipientId),
    source.workspace_id
  );
  const copy = await insertProject(exec, targetWs.id, source.name);
  await copyProjectContent(exec, sourceProjectId, copy.id);
  return {
    type: 'project',
    name: copy.name,
    workspaceId: targetWs.id,
    workspaceName: targetWs.name,
    projectId: copy.id,
    projectName: copy.name,
  };
}

// Shared container-shell creation for content items (request/folder/collection):
// the accepted copy gets a fresh project + collection named after the source
// project + collection, each auto-uniquified against what already exists in the
// target workspace.
async function createContentShell(exec, client, recipientId, sourceProject, sourceCollection) {
  const targetWs = await chooseTargetWorkspace(
    exec,
    recipientId,
    await recipientName(client, recipientId),
    sourceProject.workspace_id
  );
  const projectCopy = await insertProject(exec, targetWs.id, sourceProject.name);
  const collectionCopy = await insertCollection(exec, projectCopy.id, sourceCollection.name);
  return { targetWs, projectCopy, collectionCopy };
}

async function cloneCollectionFor(exec, client, recipientId, sourceCollectionId) {
  const source = await collectionRow(sourceCollectionId);
  const project = await projectRow(source.project_id);
  const { targetWs, projectCopy, collectionCopy } = await createContentShell(
    exec,
    client,
    recipientId,
    project,
    source
  );
  await copyCollectionContent(exec, source.id, collectionCopy.id);
  return {
    type: 'collection',
    name: collectionCopy.name,
    workspaceId: targetWs.id,
    workspaceName: targetWs.name,
    projectId: projectCopy.id,
    projectName: projectCopy.name,
    collectionId: collectionCopy.id,
    collectionName: collectionCopy.name,
  };
}

async function cloneFolderFor(exec, client, recipientId, sourceFolderId) {
  const source = await folderRow(sourceFolderId);
  const collection = await collectionRow(source.collection_id);
  const project = await projectRow(collection.project_id);
  const { targetWs, projectCopy, collectionCopy } = await createContentShell(
    exec,
    client,
    recipientId,
    project,
    collection
  );
  const rootCopy = await copyFolderSubtree(exec, source, collectionCopy.id);
  return {
    type: 'folder',
    name: rootCopy ? rootCopy.name : source.name,
    workspaceId: targetWs.id,
    workspaceName: targetWs.name,
    projectId: projectCopy.id,
    projectName: projectCopy.name,
    collectionId: collectionCopy.id,
    collectionName: collectionCopy.name,
    folderId: rootCopy ? rootCopy.id : null,
    folderName: rootCopy ? rootCopy.name : null,
  };
}

async function cloneRequestFor(exec, client, recipientId, sourceRequestId) {
  const source = await requestRow(sourceRequestId);
  const collection = await collectionRow(source.collection_id);
  const project = await projectRow(collection.project_id);
  const { targetWs, projectCopy, collectionCopy } = await createContentShell(
    exec,
    client,
    recipientId,
    project,
    collection
  );
  let landingFolderId = null;
  let landingFolderName = null;
  if (source.folder_id) {
    const ancestry = await copyFolderAncestry(exec, source.folder_id, collectionCopy.id);
    if (ancestry) {
      landingFolderId = ancestry.id;
      landingFolderName = ancestry.name;
    }
  }
  const requestCopy = await insertRequest(exec, source, collectionCopy.id, landingFolderId, source.name);
  return {
    type: 'request',
    name: requestCopy.name,
    workspaceId: targetWs.id,
    workspaceName: targetWs.name,
    projectId: projectCopy.id,
    projectName: projectCopy.name,
    collectionId: collectionCopy.id,
    collectionName: collectionCopy.name,
    ...(landingFolderId
      ? { folderId: landingFolderId, folderName: landingFolderName }
      : {}),
  };
}

// ------------------------------------------------------------------ Serialize
function personOf(row, prefix) {
  if (!row) return null;
  return {
    id: row.id,
    name: row[`${prefix}_name`] ?? row.name ?? null,
    email: row[`${prefix}_email`] ?? row.email ?? null,
  };
}

async function itemNameOf(itemType, itemId) {
  const table = ITEM_TABLE[itemType];
  if (!table) return null;
  const { rows } = await query(`SELECT name FROM ${table} WHERE id = $1`, [itemId]);
  return rows[0]?.name ?? null;
}

async function serializeSend(row, { withSender, withRecipient } = {}) {
  let sender = null;
  let recipient = null;
  if (withSender) {
    const { rows } = await query(`SELECT id, name, email FROM users WHERE id = $1`, [row.sender_id]);
    sender = rows[0] || null;
  }
  if (withRecipient) {
    const { rows } = await query(`SELECT id, name, email FROM users WHERE id = $1`, [row.recipient_id]);
    recipient = rows[0] || null;
  }
  return {
    id: row.id,
    itemType: row.item_type,
    itemId: row.item_id,
    itemName: (await itemNameOf(row.item_type, row.item_id)) ?? null,
    message: row.message ?? null,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? null,
    acceptedPath: row.accepted_path ?? null,
    sender,
    recipient,
  };
}

async function notifyUser({ userId, title, body, kind, payload, link }) {
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind, payload, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, title, body || null, kind || 'send', JSON.stringify(payload || {}), link || null]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sends] notification insert failed:', err.message);
  }
}

async function loadSendForParticipant(sendId, userId) {
  const { rows } = await query(`SELECT * FROM sends WHERE id = $1`, [sendId]);
  const send = rows[0];
  if (!send || (send.sender_id !== userId && send.recipient_id !== userId)) return null;
  return send;
}

// ------------------------------------------------------------------ Routes
// POST /api/sends — create a send (status 'pending').
router.post('/sends', async (req, res, next) => {
  try {
    const { recipientId, itemType, itemId, message } = req.body || {};
    if (!recipientId) return res.status(400).json({ error: 'recipientId is required' });
    if (!ITEM_TYPES.includes(itemType)) {
      return res.status(400).json({ error: 'itemType must be one of: request, folder, collection, project, workspace' });
    }
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    if (recipientId === req.user.id) {
      return res.status(400).json({ error: 'You cannot send an item to yourself' });
    }
    const { rows: recipientRows } = await query(
      `SELECT id, name, email FROM users WHERE id = $1 AND is_active = true`,
      [recipientId]
    );
    if (recipientRows.length === 0) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const itemRes = await itemForSend(itemType, itemId);
    if (itemRes.error) return res.status(itemRes.status).json({ error: itemRes.error });
    const own = await senderOwnsItem(req.user.id, itemRes.item);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const { rows } = await query(
      `INSERT INTO sends (sender_id, recipient_id, item_type, item_id, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, recipientId, itemType, itemId, message ? String(message) : null]
    );
    const send = rows[0];
    const itemLabel = `${capitalize(itemType)} "${itemRes.item.name}"`;
    await notifyUser({
      userId: recipientId,
      title: `${req.user.name} sent you: ${itemLabel}`,
      body: message ? String(message) : `${req.user.name} shared ${itemLabel} with you. Accept it to copy it into your workspace.`,
      kind: 'send',
      payload: {
        sendId: send.id,
        itemType,
        itemId,
        itemName: itemRes.item.name,
        status: 'pending',
        senderId: req.user.id,
        recipientId,
      },
      link: '/inbox',
    });
    await logAudit({
      actorId: req.user.id,
      entityType: 'send',
      entityId: send.id,
      action: 'send_item',
      detail: { itemType, itemId, recipientId },
      ip: req.ip,
    });
    const json = await serializeSend(send, { withSender: true, withRecipient: true });
    res.status(201).json({ send: json });
  } catch (err) {
    next(err);
  }
});

// GET /api/sends/inbox — sends to me, defaulting to pending.
router.get('/sends/inbox', async (req, res, next) => {
  try {
    const status = req.query.status;
    if (status !== undefined && status !== '' && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'status must be pending, accepted or rejected' });
    }
    const { rows } = await query(
      `SELECT * FROM sends
        WHERE recipient_id = $1
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC
        LIMIT 200`,
      [req.user.id, status || null]
    );
    const sends = [];
    for (const row of rows) {
      sends.push(await serializeSend(row, { withSender: true }));
    }
    res.json({ sends });
  } catch (err) {
    next(err);
  }
});

// GET /api/sends/outbox — every send I created.
router.get('/sends/outbox', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM sends
        WHERE sender_id = $1
        ORDER BY created_at DESC
        LIMIT 200`,
      [req.user.id]
    );
    const sends = [];
    for (const row of rows) {
      sends.push(await serializeSend(row, { withRecipient: true }));
    }
    res.json({ sends });
  } catch (err) {
    next(err);
  }
});

// GET /api/sends/recipients — reachable users for the send dialog: active users
// sharing an org or a workspace with the caller.
router.get('/sends/recipients', async (req, res, next) => {
  try {
    const { rows } = await query(
      `WITH shared_org AS (
         SELECT DISTINCT u.id, u.name, u.email, u.username
           FROM organization_members om
           JOIN organization_members om2 ON om2.org_id = om.org_id
           JOIN users u ON u.id = om2.user_id
          WHERE om.user_id = $1 AND om2.user_id <> $1 AND u.is_active = true
       ),
       shared_ws AS (
         SELECT DISTINCT u.id, u.name, u.email, u.username
           FROM workspace_members wm
           JOIN workspace_members wm2 ON wm2.workspace_id = wm.workspace_id
           JOIN users u ON u.id = wm2.user_id
          WHERE wm.user_id = $1 AND wm2.user_id <> $1 AND u.is_active = true
       )
       SELECT * FROM shared_org
       UNION
       SELECT * FROM shared_ws
       ORDER BY name, email`,
      [req.user.id]
    );
    res.json({ recipients: rows });
  } catch (err) {
    next(err);
  }
});

async function respondToSend(req, res, next, outcome) {
  try {
    const send = await loadSendForParticipant(req.params.sendId, req.user.id);
    if (!send) return res.status(404).json({ error: 'Send not found' });
    if (send.recipient_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the recipient can respond to this send' });
    }
    if (send.status !== 'pending') {
      return res.status(409).json({ error: `This send has already been ${send.status}` });
    }

    if (outcome === 'accepted') {
      const itemRes = await itemForSend(send.item_type, send.item_id);
      if (itemRes.error) {
        return res.status(itemRes.status).json({
          error: `Cannot accept: ${itemRes.error}. Ask the sender to send it again.`,
        });
      }

      const client = await pool.connect();
      let acceptedPath;
      try {
        await client.query('BEGIN');
        const exec = client.query.bind(client);
        await recipientName(client, req.user.id);
        switch (send.item_type) {
          case 'workspace':
            acceptedPath = await cloneWorkspaceFor(exec, client, req.user.id, send.item_id, itemRes.item);
            break;
          case 'project':
            acceptedPath = await cloneProjectFor(exec, client, req.user.id, send.item_id);
            break;
          case 'collection':
            acceptedPath = await cloneCollectionFor(exec, client, req.user.id, send.item_id);
            break;
          case 'folder':
            acceptedPath = await cloneFolderFor(exec, client, req.user.id, send.item_id);
            break;
          case 'request':
            acceptedPath = await cloneRequestFor(exec, client, req.user.id, send.item_id);
            break;
          default:
            throw Object.assign(new Error('Unsupported itemType'), { status: 400 });
        }
        // Concurrency guard: only flip a still-pending send to accepted.
        const updated = await client.query(
          `UPDATE sends
              SET status = 'accepted', responded_at = now(), accepted_path = $1
            WHERE id = $2 AND status = 'pending'`,
          [JSON.stringify(acceptedPath), send.id]
        );
        if (updated.rowCount !== 1) {
          throw Object.assign(new Error('This send has already been responded to'), { status: 409 });
        }
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }

      const fresh = await loadSendForParticipant(send.id, req.user.id);
      const { rows: recipientRows } = await query(
        `SELECT name FROM users WHERE id = $1`,
        [req.user.id]
      );
      await notifyUser({
        userId: send.sender_id,
        title: `${recipientRows[0]?.name || 'Someone'} accepted your ${send.item_type}: ${acceptedPath.name || itemRes.item.name}`,
        body: `The copy landed in ${acceptedPath.workspaceName}${acceptedPath.projectName ? ` / ${acceptedPath.projectName}` : ''}. You kept the original.`,
        kind: 'send',
        payload: {
          sendId: send.id,
          itemType: send.item_type,
          itemId: send.item_id,
          itemName: itemRes.item.name,
          status: 'accepted',
          acceptedPath,
          recipientId: req.user.id,
        },
        link: '/inbox',
      });
      await logAudit({
        actorId: req.user.id,
        entityType: 'send',
        entityId: send.id,
        action: 'accept_send',
        detail: { acceptedPath },
        ip: req.ip,
      });
      const json = await serializeSend(fresh, { withSender: true, withRecipient: true });
      return res.json({ send: json });
    }

    await query(
      `UPDATE sends SET status = 'rejected', responded_at = now() WHERE id = $1`,
      [send.id]
    );
    const itemName = await itemNameOf(send.item_type, send.item_id);
    const { rows: recipientRows } = await query(`SELECT name FROM users WHERE id = $1`, [req.user.id]);
    await notifyUser({
      userId: send.sender_id,
      title: `${recipientRows[0]?.name || 'Someone'} rejected your ${send.item_type}`,
      body: itemName ? `"${itemName}" was not accepted.` : null,
      kind: 'send',
      payload: {
        sendId: send.id,
        itemType: send.item_type,
        itemId: send.item_id,
        itemName,
        status: 'rejected',
        recipientId: req.user.id,
      },
      link: '/inbox',
    });
    await logAudit({
      actorId: req.user.id,
      entityType: 'send',
      entityId: send.id,
      action: 'reject_send',
      detail: {},
      ip: req.ip,
    });
    const fresh = await loadSendForParticipant(send.id, req.user.id);
    const json = await serializeSend(fresh, { withSender: true, withRecipient: true });
    res.json({ send: json });
  } catch (err) {
    next(err);
  }
}

// POST /api/sends/:sendId/accept
router.post('/sends/:sendId/accept', async (req, res, next) => respondToSend(req, res, next, 'accepted'));

// POST /api/sends/:sendId/reject
router.post('/sends/:sendId/reject', async (req, res, next) => respondToSend(req, res, next, 'rejected'));

module.exports = router;
