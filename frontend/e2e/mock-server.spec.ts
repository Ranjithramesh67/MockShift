import { test, expect } from '@playwright/test';

/**
 * Mock server per project (backlog item #4):
 *  - the per-project "Mock server" button in the sidebar tree opens the modal
 *  - you can create a mock server, add a route with a path param, and save it
 *  - a request pointed at http://127.0.0.1:3001/mock/<projectId>/... resolves
 *    against the route and returns the configured (param-substituted) body.
 *
 * Depends on the seed data created by `cd backend && npm run seed:dev`.
 */
test('create a mock server, add a route, and run a request against it', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Resolve the project + collection ids (idempotent cleanup included).
  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const content = (await (await page.request.get(`/api/workspaces/${myWs.id}/content`)).json()) as {
    projects: Array<{ id: string; name: string; can_access: boolean }>;
    collections: Array<{ id: string; name: string; project_id: string }>;
    requests: Array<{ id: string; name: string; collection_id: string }>;
  };
  const project = content.projects.find((p) => p.name === 'Default Project' && p.can_access)!;
  const demoCol = content.collections.find((c) => c.name === 'Mock API Demo')!;

  // Clean up leftovers from previous runs: drop the mock server + test request.
  const srvRes = await page.request.get(`/api/projects/${project.id}/mock-server`);
  const existing = (await srvRes.json()).mockServer as { id: string; name: string } | null;
  if (existing) {
    await page.request.delete(`/api/mock-servers/${existing.id}`);
  }
  for (const r of content.requests.filter((x) => x.name === 'mock-e2e-request')) {
    await page.request.delete(`/api/requests/${r.id}`);
  }

  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('request-configurator')).toBeVisible();

  // Open the mock server modal for the Default Project.
  await page.getByTestId('mock-server-Default Project').click();
  await expect(page.getByTestId('mock-server-modal')).toBeVisible();

  // Create the mock server.
  await page.getByTestId('mock-server-name').fill('E2E Mock');
  await page.getByTestId('mock-server-create').click();
  await expect(page.getByTestId('mock-base-url')).toContainText(`/mock/${project.id}`);

  // Add a route: GET /users/:id -> {"userId":"{{id}}"}.
  await page.getByTestId('mock-add-route').click();
  await page.getByTestId('mock-route-method-0').selectOption('GET');
  await page.getByTestId('mock-route-path-0').fill('/users/:id');
  await page.getByTestId('mock-route-status-0').fill('200');
  await page.getByTestId('mock-route-body-0').fill('{"userId":"{{id}}"}');
  await page.getByTestId('mock-save-routes').click();
  await expect(page.getByTestId('mock-save-routes')).toBeVisible();

  // Create a request pointed at the mock server and run it.
  const reqRes = await page.request.post('/api/requests', {
    data: {
      collectionId: demoCol.id,
      name: 'mock-e2e-request',
      method: 'GET',
      url: `http://127.0.0.1:3001/mock/${project.id}/users/42`,
    },
  });
  expect(reqRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('workspace-My Workspace').click();
  await page.getByTestId('sidebar-request-mock-e2e-request').click();
  await expect(page.getByTestId('url-input')).toBeVisible();
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-pane')).toBeVisible();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');
  await expect(page.getByTestId('response-pane')).toContainText('"userId": "42"');
});
