// Prepare deterministic demo data for the tutorial, idempotently, in each
// seeded user's own workspace. Nothing is deleted; missing resources are
// created and existing ones reused.

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

async function ensureWorkspaceContent(client) {
  const { workspaces } = await client.req('GET', '/api/workspaces');
  const workspace =
    workspaces.find((w) => w.name === 'My Workspace') || workspaces[0];
  if (!workspace) throw new Error('user has no workspace');

  const content = await client.req('GET', `/api/workspaces/${workspace.id}/content`);
  const project =
    content.projects.find((p) => p.can_access && p.name === 'Default Project') ||
    content.projects.find((p) => p.can_access);
  if (!project) throw new Error('user has no accessible project');

  // Collection.
  let collection = content.collections.find((c) => c.name === 'Payments API');
  if (!collection) {
    const created = await client.req('POST', '/api/collections', {
      projectId: project.id,
      name: 'Payments API',
    });
    collection = created.collection;
  }

  // Requests (idempotent by name).
  const fresh = await client.req('GET', `/api/workspaces/${workspace.id}/content`);
  const existingNames = new Set(
    fresh.requests.filter((r) => r.collection_id === collection.id).map((r) => r.name)
  );
  for (const request of REQUESTS) {
    if (existingNames.has(request.name)) continue;
    await client.req('POST', '/api/requests', {
      collectionId: collection.id,
      name: request.name,
      method: request.method,
      url: request.url,
      apiType: 'REST',
    });
  }

  // Environments.
  const envs = await client.req('GET', `/api/workspaces/${workspace.id}/environments`);
  let staging = envs.environments.find((e) => e.name === 'Staging');
  if (!staging) {
    const created = await client.req('POST', `/api/workspaces/${workspace.id}/environments`, {
      name: 'Staging',
      makeActive: true,
    });
    staging = created.environment;
  }
  if (!envs.environments.find((e) => e.name === 'Production')) {
    await client.req('POST', `/api/workspaces/${workspace.id}/environments`, {
      name: 'Production',
      makeActive: false,
    });
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
    const created = await client.req('POST', `/api/projects/${project.id}/mock-server`, {
      name: 'Payments Mock',
      enabled: true,
    });
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

  return {
    userId: null,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    projectId: project.id,
    projectName: project.name,
    collectionId: collection.id,
    mockServerId: mockServer.id,
    mockServerName: 'Payments Mock',
  };
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixtures = {};
  for (const [key, account] of Object.entries(USERS)) {
    console.log(`Preparing fixtures for ${key} (${account.email}) ...`);
    const client = await loginAs(account);
    const me = await client.req('GET', '/api/auth/me');
    const user = me.user || me;
    const info = await ensureWorkspaceContent(client);
    fixtures[key] = { email: account.email, role: user.role, userId: user.id, ...info };
    console.log(`  workspace="${info.workspaceName}" project="${info.projectName}" collection=${info.collectionId}`);
  }
  await writeFile(path.join(WORK, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
  console.log('\nFixtures ready -> .work/fixtures.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
