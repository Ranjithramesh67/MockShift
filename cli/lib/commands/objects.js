'use strict';

const { UsageError } = require('../errors');
const { loadConfig, saveConfig } = require('../config');
const { firstOption, hasFlag } = require('../parser');
const { buildSession, makeApiClient, defaultWorkspaceId } = require('../session');
const { renderTable, elide, makePainter } = require('../format');

const HELP_TOP = `Commands to browse and manage API Hub workspaces, projects,
collections and requests:

  apihub workspace list
  apihub workspace use <id>
  apihub project list [--workspace <id>]
  apihub project create <name> [--workspace <id>] [--description <text>]
  apihub collection list [--project <id>] [--workspace <id>]
  apihub request list [--collection <id>] [--workspace <id>]
  apihub request show <requestId>

Run "apihub <command> --help" for details on a command.`;

async function requireWorkspace(ctx, config, { forCreate = false } = {}) {
  const id = defaultWorkspaceId(ctx, config);
  if (!id) {
    throw new UsageError(
      forCreate
        ? 'A workspace is required. Pass --workspace <id> or select a default with "apihub workspace use <id>".'
        : 'No workspace selected. Pass --workspace <id> or select a default with "apihub workspace use <id>".'
    );
  }
  return id;
}

async function workspaceList(ctx, io) {
  const session = buildSession(ctx);
  const client = makeApiClient(session);
  const res = await client.get('/api/workspaces');
  const config = loadConfig();
  const workspaces = (res.body && res.body.workspaces) || [];

  if (hasFlag(ctx.options, 'json')) {
    io.out(JSON.stringify(res.body, null, 2));
    return 0;
  }

  const painter = makePainter(ctx.useColor);
  const rows = workspaces.map((w) => {
    const defaultMark = w.id === config.defaultWorkspaceId ? ' *' : '';
    return [
      w.id,
      painter.green(`${w.name}${defaultMark}`),
      w.role || '',
      String(w.visibility || ''),
      w.organization_name || '',
    ];
  });
  if (rows.length === 0) {
    io.out('No workspaces available for this token.');
    return 0;
  }
  io.out(renderTable(rows, {
    header: ['ID', 'NAME', 'ROLE', 'VISIBILITY', 'ORGANIZATION'],
    paint: painter,
  }));
  io.out('');
  io.out(painter.dim('* = default workspace (apihub workspace use <id>)'));
  return 0;
}

async function workspaceUse(ctx, io) {
  const id = ctx.args[0];
  if (!id) throw new UsageError('Usage: apihub workspace use <workspaceId>');

  const session = buildSession(ctx);
  const client = makeApiClient(session);
  const res = await client.get('/api/workspaces');
  const workspaces = (res.body && res.body.workspaces) || [];
  const match = workspaces.find((w) => w.id === id);
  if (!match) {
    throw new UsageError(
      `Workspace "${id}" is not accessible. List your workspaces with "apihub workspace list".`
    );
  }
  const config = loadConfig();
  config.defaultWorkspaceId = id;
  saveConfig(config);
  io.out(`Default workspace set to ${match.name} (${id}).`);
  return 0;
}

async function fetchTree(client, workspaceId) {
  const res = await client.get(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/content`
  );
  return res.body || {};
}

async function projectWorkspace(client, projectId) {
  try {
    const res = await client.get(`/api/projects/${encodeURIComponent(projectId)}/overview`);
    const body = res.body || {};
    return body.workspace_id || null;
  } catch (err) {
    if (err && err.status === 404) {
      throw new UsageError(`Project "${projectId}" was not found.`);
    }
    throw err;
  }
}

async function locateCollectionWorkspace(client, collectionId, baseWorkspaceId) {
  if (baseWorkspaceId) {
    const tree = await fetchTree(client, baseWorkspaceId);
    const found = (tree.collections || []).some((c) => c.id === collectionId);
    if (found) return { workspaceId: baseWorkspaceId, tree };
  }
  const res = await client.get('/api/workspaces');
  const workspaces = (res.body && res.body.workspaces) || [];
  for (const ws of workspaces) {
    if (ws.id === baseWorkspaceId) continue;
    const tree = await fetchTree(client, ws.id);
    if ((tree.collections || []).some((c) => c.id === collectionId)) {
      return { workspaceId: ws.id, tree };
    }
  }
  return null;
}

async function projectList(ctx, io) {
  const session = buildSession(ctx);
  const config = loadConfig();
  const workspaceId = await requireWorkspace(ctx, config);
  const client = makeApiClient(session);
  const tree = await fetchTree(client, workspaceId);

  if (hasFlag(ctx.options, 'json')) {
    io.out(JSON.stringify({ workspaceId, projects: tree.projects || [] }, null, 2));
    return 0;
  }

  const painter = makePainter(ctx.useColor);
  const projects = tree.projects || [];
  if (projects.length === 0) {
    io.out(`No projects in workspace ${workspaceId}.`);
    return 0;
  }
  const rows = projects.map((p) => {
    const access =
      p.can_access === true
        ? painter.green('yes')
        : p.access_status === 'PENDING'
          ? painter.yellow('pending')
          : painter.red('no');
    return [p.id, p.name, access];
  });
  io.out(renderTable(rows, { header: ['ID', 'NAME', 'ACCESS'], paint: painter }));
  return 0;
}

async function projectCreate(ctx, io) {
  const name = ctx.args[0];
  if (!name) throw new UsageError('Usage: apihub project create <name> [--workspace <id>] [--description <text>]');
  const session = buildSession(ctx);
  const config = loadConfig();
  const workspaceId = await requireWorkspace(ctx, config, { forCreate: true });
  const client = makeApiClient(session);
  const description = firstOption(ctx.options, 'description');

  const res = await client.post('/api/projects', {
    body: { name, workspaceId, description: description || undefined },
  });
  const created = res.body && (res.body.project || res.body);
  if (hasFlag(ctx.options, 'json')) {
    io.out(JSON.stringify(res.body, null, 2));
  } else {
    io.out(`Created project ${name} (${created && created.id ? created.id : '?'})`);
  }
  return 0;
}

async function collectionList(ctx, io) {
  const session = buildSession(ctx);
  const config = loadConfig();
  const client = makeApiClient(session);
  const projectId = firstOption(ctx.options, 'project');
  const workspaceFlag = firstOption(ctx.options, 'workspace');

  let workspaceId = workspaceFlag;
  let tree = null;
  if (projectId) {
    workspaceId = await projectWorkspace(client, projectId);
    tree = await fetchTree(client, workspaceId);
  } else {
    workspaceId = await requireWorkspace(ctx, config);
    tree = await fetchTree(client, workspaceId);
  }

  if (hasFlag(ctx.options, 'json')) {
    io.out(JSON.stringify(tree.collections || [], null, 2));
    return 0;
  }

  const painter = makePainter(ctx.useColor);
  const projects = tree.projects || [];
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const collections = (tree.collections || [])
    .filter((c) => !projectId || c.project_id === projectId)
    .map((c) => ({
      ...c,
      project_name: nameById.get(c.project_id) || c.project_id,
      request_count: (tree.requests || []).filter((r) => r.collection_id === c.id).length,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (collections.length === 0) {
    io.out(projectId ? `No collections in project ${projectId}.` : 'No collections in this workspace.');
    return 0;
  }
  const rows = collections.map((c) => [
    c.id,
    painter.green(c.name),
    c.project_name,
    String(c.request_count),
    c.has_auth ? 'yes' : '',
  ]);
  io.out(renderTable(rows, { header: ['ID', 'NAME', 'PROJECT', 'REQUESTS', 'AUTH'], paint: painter }));
  return 0;
}

async function requestList(ctx, io) {
  const session = buildSession(ctx);
  const config = loadConfig();
  const client = makeApiClient(session);
  const collectionId = firstOption(ctx.options, 'collection');
  const workspaceFlag = firstOption(ctx.options, 'workspace');

  let tree;
  if (collectionId) {
    const located = await locateCollectionWorkspace(client, collectionId, workspaceFlag);
    if (!located) {
      throw new UsageError(
        `Collection "${collectionId}" was not found in any accessible workspace.`
      );
    }
    tree = located.tree;
  } else {
    const workspaceId = await requireWorkspace(ctx, config);
    tree = await fetchTree(client, workspaceId);
  }

  if (hasFlag(ctx.options, 'json')) {
    const rows = (tree.requests || []).filter(
      (r) => !collectionId || r.collection_id === collectionId
    );
    io.out(JSON.stringify(rows, null, 2));
    return 0;
  }

  const painter = makePainter(ctx.useColor);
  const nameById = new Map((tree.collections || []).map((c) => [c.id, c.name]));
  const requests = (tree.requests || [])
    .filter((r) => !collectionId || r.collection_id === collectionId)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (requests.length === 0) {
    io.out(collectionId ? `No requests in collection ${collectionId}.` : 'No requests in this workspace.');
    return 0;
  }
  const rows = requests.map((r) => [
    r.id,
    painter.green(r.name),
    r.method || '',
    elide(r.url || '', 90),
    nameById.get(r.collection_id) || r.collection_id,
  ]);
  io.out(renderTable(rows, { header: ['ID', 'NAME', 'METHOD', 'URL', 'COLLECTION'], paint: painter }));
  return 0;
}

async function requestShow(ctx, io) {
  const id = ctx.args[0];
  if (!id) throw new UsageError('Usage: apihub request show <requestId>');
  const session = buildSession(ctx);
  const client = makeApiClient(session);
  const res = await client.get(`/api/requests/${encodeURIComponent(id)}`);
  const body = res.body || {};
  const request = body.request;

  if (hasFlag(ctx.options, 'json')) {
    io.out(JSON.stringify(body, null, 2));
    return 0;
  }

  if (!request) {
    io.out(JSON.stringify(body, null, 2));
    return 0;
  }
  const painter = makePainter(ctx.useColor);
  const lines = [
    ['ID', request.id],
    ['NAME', request.name],
    ['METHOD', request.method],
    ['URL', request.url],
    ['API TYPE', request.apiType],
    ['COLLECTION', request.collectionId],
    ['FOLDER', request.folderId || '(root)'],
    ['WORKSPACE', request.workspaceId || '?'],
    ['HEADERS', `${(request.headers || []).filter((h) => h.enabled !== false).length} enabled`],
    ['QUERY PARAMS', `${(request.queryParams || []).filter((h) => h.enabled !== false).length} enabled`],
    ['BODY', request.bodyType || 'NONE'],
    ['FORMULA', request.formula ? 'set' : 'none'],
    ['ASSERTIONS', `${(request.assertions || []).length}`],
  ];
  const width = Math.max(...lines.map(([k]) => k.length)) + 2;
  for (const [key, value] of lines) {
    io.out(`${painter.bold(key.padEnd(width))}${String(value === null || value === undefined ? '' : value)}`);
  }
  return 0;
}

module.exports = {
  workspaceList,
  workspaceUse,
  projectList,
  projectCreate,
  collectionList,
  requestList,
  requestShow,
  fetchTree,
  projectWorkspace,
  requireWorkspace,
  HELP_TOP,
};
