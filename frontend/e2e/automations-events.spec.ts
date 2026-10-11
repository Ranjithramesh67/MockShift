import { test, expect } from '@playwright/test';

/**
 * Workflow event triggers (#5): ON_REQUEST + ON_RUN_FAILURE automations.
 *  - the New automation modal offers "On request run" / "On run failure"
 *  - an ON_REQUEST automation watching "GET all posts" fires its workflow when
 *    that request runs
 *  - an ON_RUN_FAILURE automation fires its workflow when a request run fails
 *
 * Depends on seed data created by `cd backend && npm run seed:dev` (ADMIN
 * account + "Mock API Demo" collection on :3999) and on the mock upstream
 * (:3999) being up.
 */

const EMAIL = 'boss1785867669@test.io';
const PASSWORD = 'bosspass123';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
}

async function seedIds(page: import('@playwright/test').Page) {
  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const content = (await (await page.request.get(`/api/workspaces/${myWs.id}/content`)).json()) as {
    projects: Array<{ id: string; name: string }>;
    requests: Array<{ id: string; name: string }>;
  };
  const project = content.projects.find((p) => p.name === 'Default Project')!;
  const getPosts = content.requests.find((r) => r.name === 'GET all posts')!;
  return { projectId: project.id, getPostsId: getPosts.id };
}

async function createWorkflow(
  page: import('@playwright/test').Page,
  projectId: string,
  name: string,
  requestId: string
) {
  const res = await page.request.post('/api/workflows', {
    data: {
      projectId,
      name,
      definition: { steps: [{ id: 'step-1', label: 'E2E step', requestId, onFailure: 'abort' }] },
    },
  });
  expect(res.status(), 'create workflow via API').toBe(201);
  return (await res.json()).workflow as { id: string };
}

async function waitForRun(
  page: import('@playwright/test').Page,
  workflowId: string,
  predicate: (r: { trigger: string }) => boolean,
  label: string
) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const res = await page.request.get(`/api/workflows/${workflowId}/runs?limit=50`);
    const runs = (await res.json()).runs as Array<{ trigger: string }>;
    const found = runs.find(predicate);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await page.waitForTimeout(400);
  }
}

test('creates an ON_REQUEST automation and it fires when the watched request runs', async ({ page }) => {
  await login(page);
  const { projectId, getPostsId } = await seedIds(page);
  const wf = await createWorkflow(page, projectId, `E2E OnReq WF ${Date.now()}`, getPostsId);

  await page.goto('/automations');
  await expect(page.getByTestId('automations-page')).toBeVisible();
  await page.getByTestId('new-automation').click();
  await expect(page.getByTestId('new-automation-modal')).toBeVisible();

  await page.getByTestId('automation-name').fill(`E2E On Request ${Date.now()}`);
  await page.getByTestId('automation-project').selectOption(projectId);
  await page.getByTestId('automation-workflow').selectOption(wf.id);
  await page.getByTestId('automation-trigger').selectOption('ON_REQUEST');

  // The watch-request selector appears and offers the demo request.
  await expect(page.getByTestId('automation-event-request')).toBeVisible();
  await page.getByTestId('automation-event-request').selectOption(getPostsId);

  await page.getByTestId('automation-create').click();
  await expect(page.getByTestId('automation-notice')).toContainText('Automation created.');

  // Card shows the new trigger type.
  const card = page.getByTestId('automation-list').getByText('On request run').first();
  await expect(card).toBeVisible();

  // Run the watched request via the API; its ON_REQUEST workflow must fire.
  const runRes = await page.request.post(`/api/requests/${getPostsId}/run`);
  expect(runRes.ok(), 'run watched request').toBeTruthy();
  await waitForRun(page, wf.id, (r) => r.trigger === 'ON_REQUEST', 'ON_REQUEST workflow run');
});

test('creates an ON_RUN_FAILURE automation and it fires when a request run fails', async ({ page }) => {
  await login(page);
  const { projectId, getPostsId } = await seedIds(page);
  const wf = await createWorkflow(page, projectId, `E2E OnFail WF ${Date.now()}`, getPostsId);

  // Build the failing request in a dedicated collection (connection refused) so
  // the seeded "Mock API Demo" collection keeps its exact request count.
  const colRes = await page.request.post('/api/collections', {
    data: { projectId, name: `E2E failing col ${Date.now()}` },
  });
  expect(colRes.status(), 'create failing collection').toBe(201);
  const failingCollectionId = (await colRes.json()).collection.id;
  const failingName = `E2E failing ${Date.now()}`;
  const failing = await page.request.post('/api/requests', {
    data: { collectionId: failingCollectionId, name: failingName, method: 'GET', url: 'http://127.0.0.1:1/nope' },
  });
  expect(failing.status(), 'create failing request').toBe(201);
  const failingId = (await failing.json()).request.id;

  await page.goto('/automations');
  await page.getByTestId('new-automation').click();
  await page.getByTestId('automation-name').fill(`E2E On Failure ${Date.now()}`);
  await page.getByTestId('automation-project').selectOption(projectId);
  await page.getByTestId('automation-workflow').selectOption(wf.id);
  await page.getByTestId('automation-trigger').selectOption('ON_RUN_FAILURE');

  // The watch-workflow selector appears with the "Any run" default.
  await expect(page.getByTestId('automation-source-workflow')).toBeVisible();
  await page.getByTestId('automation-create').click();
  await expect(page.getByTestId('automation-notice')).toContainText('Automation created.');

  const card = page.getByTestId('automation-list').getByText('On run failure').first();
  await expect(card).toBeVisible();

  // Run the failing request; the ON_RUN_FAILURE workflow must fire.
  const runRes = await page.request.post(`/api/requests/${failingId}/run`);
  expect(runRes.ok(), 'run failing request').toBeTruthy();
  await waitForRun(page, wf.id, (r) => r.trigger === 'ON_RUN_FAILURE', 'ON_RUN_FAILURE workflow run');
});
