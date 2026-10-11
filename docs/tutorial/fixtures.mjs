// Prepare deterministic demo data for the tutorial, idempotently, in each
// seeded user's own workspace. Nothing is deleted; missing resources are
// created and existing ones reused. Every section is best-effort: a failure is
// logged and the demo simply shows less on that page rather than aborting.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOGIN } from './script.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(__dirname, '.work');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const UPSTREAM = process.env.MOCK_UPSTREAM_BASE || 'http://127.0.0.1:3999';

const USERS = { admin: LOGIN.admin, manager: LOGIN.manager, editor: LOGIN.editor };

function createClient() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async req(method, apiPath, body) {
      const res = await fetch(`${BASE_URL}${apiPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (setCookies.length) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      if (!res.ok) {
        throw new Error(`${method} ${apiPath} -> ${res.status} ${text.slice(0, 300)}`);
      }
      return json;
    },
  };
}

async function loginAs(account) {
  const client = createClient();
  await client.req('POST', '/api/auth/login', account);
  return client;
}

const REQUESTS = [
  { name: 'List payments', method: 'GET', url: `${UPSTREAM}/posts` },
  { name: 'Create payment', method: 'POST', url: `${UPSTREAM}/posts`, bodyText: '{"amount": 4200, "currency": "USD"}' },
  { name: 'Get payment', method: 'GET', url: `${UPSTREAM}/posts/1` },
  { name: 'Delete payment', method: 'DELETE', url: `${UPSTREAM}/posts/2` },
];

const MOCK_ROUTES = [
  { method: 'GET', path: '/payments/health', status: 200, body: '{"status":"ok"}' },
  { method: 'GET', path: '/payments/1', status: 200, body: '{"id":1,"amount":4200,"currency":"USD","status":"captured"}' },
  { method: 'POST', path: '/payments', status: 201, body: '{"id":99,"status":"created"}' },
];

const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'Payments API', version: '1.0.0', description: 'Payment processing endpoints.' },
  servers: [{ url: UPSTREAM }],
  tags: [{ name: 'Payments', description: 'Create and inspect payments.' }],
  paths: {
    '/payments/health': {
      get: {
        tags: ['Payments'],
        operationId: 'getHealth',
        summary: 'Service health',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/payments/1': {
      get: {
        tags: ['Payments'],
        operationId: 'getPayment',
        summary: 'Get a payment',
        responses: { 200: { description: 'A payment' }, 503: { description: 'Unavailable' } },
      },
    },
    '/payments': {
      post: {
        tags: ['Payments'],
        operationId: 'createPayment',
        summary: 'Create a payment',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Created' } },
      },
    },
  },
};

const DOC_BLOCKS = [
  { id: null, type: 'heading', content: { text: 'Payments API overview' } },
  {
    id: null,
    type: 'text',
    content: {
      text: 'The Payments API lets clients create a payment, fetch a single payment and check service health. Every endpoint returns JSON.',
    },
  },
  { id: null, type: 'code', content: { language: 'bash', code: `curl ${UPSTREAM}/posts/1` } },
  {
    id: null,
    type: 'list',
    content: {
      style: 'bullet',
      items: [
        'Base URL is resolved from the active environment',
        'Auth uses a bearer token stored in the Staging environment',
        'Errors return JSON with a message field',
      ],
    },
  },
  { id: null, type: 'response', content: { status: 200, body: '{\n  "id": 1,\n  "amount": 4200,\n  "currency": "USD"\n}' } },
];

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.log(`   ! ${label}: ${String(err).split('\n')[0]}`);
    return null;
  }
}

async function ensureWorkspaceContent(client) {
  const { workspaces } = await client.req('GET', '/api/workspaces');
  const workspace = workspaces.find((w) => w.name === 'My Workspace') || workspaces[0];
  if (!workspace) throw new Error('user has no workspace');

  let content = await client.req('GET', `/api/workspaces/${workspace.id}/content`);
  let project =
    content.projects.find((p) => p.can_access && p.name === 'Default Project') ||
    content.projects.find((p) => p.can_access);
  if (!project) throw new Error('user has no accessible project');

  // Collection.
  let collection = content.collections.find((c) => c.name === 'Payments API');
  if (!collection) {
    const created = await client.req('POST', '/api/collections', { projectId: project.id, name: 'Payments API' });
    collection = created.collection;
  }

  // Requests (idempotent by name).
  content = await client.req('GET', `/api/workspaces/${workspace.id}/content`);
  const existing = new Map(content.requests.filter((r) => r.collection_id === collection.id).map((r) => [r.name, r]));
  for (const request of REQUESTS) {
    if (existing.has(request.name)) continue;
    const created = await client.req('POST', '/api/requests', {
      collectionId: collection.id,
      name: request.name,
      method: request.method,
      url: request.url,
      apiType: 'REST',
    });
    existing.set(request.name, created.request);
  }

  // Environments.
  const envs = await client.req('GET', `/api/workspaces/${workspace.id}/environments`);
  let staging = envs.environments.find((e) => e.name === 'Staging');
  if (!staging) {
    const created = await client.req('POST', `/api/workspaces/${workspace.id}/environments`, { name: 'Staging', makeActive: true });
    staging = created.environment;
  }
  if (!envs.environments.find((e) => e.name === 'Production')) {
    await client.req('POST', `/api/workspaces/${workspace.id}/environments`, { name: 'Production', makeActive: false });
  }
  const vars = await client.req('GET', `/api/environments/${staging.id}/variables`);
  const varKeys = new Set(vars.variables.map((v) => v.key));
  for (const variable of [
    { key: 'base_url', value: UPSTREAM, isSecret: false },
    { key: 'api_token', value: 'demo-token-123', isSecret: true },
  ]) {
    if (!varKeys.has(variable.key)) {
      await client.req('POST', `/api/environments/${staging.id}/variables`, variable);
    }
  }

  // Mock server + routes + a scenario override.
  let { mockServer } = await client.req('GET', `/api/projects/${project.id}/mock-server`);
  if (!mockServer) {
    const created = await client.req('POST', `/api/projects/${project.id}/mock-server`, { name: 'Payments Mock', enabled: true });
    mockServer = created.mockServer;
  } else if (mockServer.name !== 'Payments Mock') {
    await client.req('PATCH', `/api/mock-servers/${mockServer.id}`, { name: 'Payments Mock', enabled: true });
  }
  const routesResult = await client.req('GET', `/api/mock-servers/${mockServer.id}/routes`);
  const routeByName = new Map(routesResult.routes.map((r) => [`${r.method} ${r.path}`, r]));
  for (const route of MOCK_ROUTES) {
    const key = `${route.method} ${route.path}`;
    if (!routeByName.has(key)) {
      const created = await client.req('POST', `/api/mock-servers/${mockServer.id}/routes`, route);
      routeByName.set(key, created.route);
    }
  }
  const scenarios = await client.req('GET', `/api/mock-scenarios?mockServerId=${mockServer.id}`);
  let scenario = scenarios.scenarios.find((s) => s.name === 'maintenance');
  if (!scenario) {
    const created = await client.req('POST', '/api/mock-scenarios', {
      mockServerId: mockServer.id,
      name: 'maintenance',
      description: 'Return 503 for the payment detail endpoint.',
    });
    scenario = created.scenario;
  }
  const detailRoute = routeByName.get('GET /payments/1');
  const responses = await client.req('GET', `/api/mock-routes/${detailRoute.id}/responses`);
  if (!responses.responses.some((r) => r.scenario_id === scenario.id)) {
    await client.req('POST', `/api/mock-routes/${detailRoute.id}/responses`, {
      scenarioId: scenario.id,
      name: 'Payment service down',
      status: 503,
      body: '{"error":"service unavailable"}',
    });
  }

  const requestIds = {};
  for (const [name, row] of existing) requestIds[name] = row.id;

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    projectId: project.id,
    projectName: project.name,
    collectionId: collection.id,
    mockServerId: mockServer.id,
    requestIds,
  };
}

// Run a couple of stored requests so History and the Manage run list have rows.
async function ensureRuns(client, requestIds) {
  for (const name of ['List payments', 'Get payment']) {
    const id = requestIds[name];
    if (id) await safe(`run ${name}`, () => client.req('POST', `/api/requests/${id}/run`));
  }
}

// A couple of docs pages with real blocks; returns the first page id.
async function ensureDocs(client, workspaceId, projectId) {
  const { pages } = await client.req('GET', `/api/docs?workspaceId=${workspaceId}`);
  const wanted = ['Payments API overview', 'Authentication', 'Error handling'];
  let first = null;
  for (const title of wanted) {
    let page = pages.find((p) => p.title === title);
    if (!page) {
      const created = await client.req('POST', '/api/docs', { workspaceId, projectId, title });
      page = created.page;
    }
    if (!first) first = page.id;
    if (title === 'Payments API overview' && (page.blockCount ?? 0) === 0) {
      await safe('docs blocks', () => client.req('PUT', `/api/docs/${page.id}/blocks`, { blocks: DOC_BLOCKS }));
    }
  }
  return first;
}

async function ensureContract(client, projectId) {
  const { specs } = await client.req('GET', `/api/contracts?projectId=${projectId}`);
  if (specs.length) return specs[0].id;
  const result = await client.req('POST', '/api/contracts/import', {
    projectId,
    name: 'Payments API',
    spec: OPENAPI,
    generateRequests: false,
  });
  return result.spec?.id ?? null;
}

async function ensureMonitor(client, projectId, requestId) {
  const { monitors } = await client.req('GET', `/api/monitors?projectId=${projectId}`);
  if (monitors.some((m) => m.name === 'Payments health')) return;
  await client.req('POST', '/api/monitors', {
    projectId,
    name: 'Payments health',
    targetType: 'REQUEST',
    requestId,
    scheduleCron: '*/5 * * * *',
    enabled: true,
  });
}

async function ensureAutomation(client, projectId) {
  const { automations } = await client.req('GET', '/api/automations');
  if (automations.some((a) => a.name === 'Nightly smoke')) return;
  const { workflows } = await client.req('GET', `/api/workflows?projectId=${projectId}`);
  let workflow = workflows.find((w) => w.name === 'Smoke suite');
  if (!workflow) {
    const created = await client.req('POST', '/api/workflows', {
      projectId,
      name: 'Smoke suite',
      definition: { steps: [] },
    });
    workflow = created.workflow;
  }
  await client.req('POST', '/api/automations', {
    name: 'Nightly smoke',
    projectId,
    workflowId: workflow.id,
    triggerType: 'SCHEDULE',
    scheduleCron: '0 6 * * *',
    enabled: true,
  });
}

async function ensureCollab(client, collectionId) {
  const { comments } = await client.req('GET', `/api/comments?targetType=collection&targetId=${collectionId}`);
  if (!comments.length) {
    await client.req('POST', '/api/comments', {
      targetType: 'collection',
      targetId: collectionId,
      body: 'Looks good — can we add an assertion for the 503 maintenance case?',
    });
  }
  const { reviews } = await client.req('GET', `/api/reviews?collectionId=${collectionId}`);
  if (!reviews.length) {
    await safe('review', () => client.req('POST', '/api/reviews', { collectionId, comment: 'Ready for review' }));
  }
  const { versions } = await client.req('GET', `/api/versions?collectionId=${collectionId}`);
  if (!versions.length) {
    await safe('version', () => client.req('POST', '/api/versions', { collectionId, label: 'v1 baseline' }));
  }
}

async function ensureTeam(client) {
  const { teams } = await client.req('GET', '/api/teams');
  if (teams.some((t) => t.name === 'Payments Team')) return;
  await safe('team', () => client.req('POST', '/api/teams', { name: 'Payments Team' }));
}

async function ensureToken(client) {
  const { tokens } = await client.req('GET', '/api/tokens');
  if (tokens.some((t) => t.name === 'CI pipeline')) return;
  await safe('token', () => client.req('POST', '/api/tokens', { name: 'CI pipeline', scopes: ['read', 'runs'] }));
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixtures = {};
  const clients = {};

  for (const [key, account] of Object.entries(USERS)) {
    console.log(`Preparing fixtures for ${key} (${account.email}) ...`);
    const client = await loginAs(account);
    clients[key] = client;
    const me = await client.req('GET', '/api/auth/me');
    const user = me.user || me;
    const info = await ensureWorkspaceContent(client);
    fixtures[key] = { email: account.email, role: user.role, userId: user.id, ...info };
    console.log(`  workspace="${info.workspaceName}" project="${info.projectName}"`);
  }

  // ---- Editor-owned product pages -----------------------------------------
  const editor = clients.editor;
  const ed = fixtures.editor;
  await ensureRuns(editor, ed.requestIds);
  ed.docsPageId = await safe('docs', () => ensureDocs(editor, ed.workspaceId, ed.projectId));
  ed.contractSpecId = await safe('contract', () => ensureContract(editor, ed.projectId));
  await safe('monitor', () => ensureMonitor(editor, ed.projectId, ed.requestIds['List payments']));
  await safe('automation', () => ensureAutomation(editor, ed.projectId));
  await safe('collab', () => ensureCollab(editor, ed.collectionId));
  await safe('team', () => ensureTeam(editor));
  await safe('editor token', () => ensureToken(editor));

  // ---- Admin-owned platform pages -----------------------------------------
  const admin = clients.admin;
  const ad = fixtures.admin;
  await ensureRuns(admin, ad.requestIds);
  await safe('admin token', () => ensureToken(admin));
  await safe('admin docs', () => ensureDocs(admin, ad.workspaceId, ad.projectId));

  // A request sent to the admin so the inbox has an incoming item.
  await safe('admin sends', async () => {
    const { sends } = await admin.req('GET', '/api/sends/inbox');
    if (sends.length) return;
    const recipients = await admin.req('GET', '/api/sends/recipients');
    const dev = recipients.recipients.find((r) => r.email === fixtures.editor.email);
    const editorClient = clients.editor;
    if (dev) {
      await editorClient.req('POST', '/api/sends', {
        recipientId: ad.userId,
        itemType: 'request',
        itemId: ed.requestIds['List payments'],
        message: 'Sharing the payments collection for reuse.',
      });
    }
  });

  // A pending access request so the Manage/Admin access tabs have a row. The
  // editor has no access to the manager's project, so the request is real.
  await safe('access request', async () => {
    const targetProject = fixtures.manager?.projectId;
    if (!targetProject) return;
    const mine = await editor.req('GET', '/api/access-requests/mine');
    if (mine.accessRequests.some((r) => r.status === 'pending')) return;
    await editor.req('POST', `/api/projects/${targetProject}/access-requests`, {
      reason: 'Need access to help with the payments integration.',
      role: 'VIEWER',
    });
  });

  await writeFile(path.join(WORK, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
  console.log('\nFixtures ready -> .work/fixtures.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
