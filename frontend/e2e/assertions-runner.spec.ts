import { test, expect } from '@playwright/test';

/**
 * Response assertions + collection runner:
 *  - the Tests tab lets you add a per-request assertion (status eq 200)
 *  - after Send the response pane shows the assertion result
 *  - the "Run collection" button runs every request in the collection and
 *    shows per-request pass/fail + a summary.
 *
 * Depends on the seed data created by `cd backend && npm run seed:dev`
 * (ADMIN account, "My Workspace", "Mock API Demo" collection on :3999).
 */
test('adds a status assertion, sees it pass, and runs the collection', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Start from a clean slate: clear any leftover assertions on "GET all posts"
  // from previous runs (the session cookie is shared with the browser).
  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const content = (await (await page.request.get(`/api/workspaces/${myWs.id}/content`)).json()) as {
    requests: Array<{ id: string; name: string }>;
  };
  const req = content.requests.find((r) => r.name === 'GET all posts')!;
  await page.request.put(`/api/requests/${req.id}`, { data: { assertions: [] } });

  await page.getByTestId('workspace-My Workspace').click();
  await page.getByTestId('sidebar-request-GET all posts').click();
  await expect(page.getByTestId('url-input')).toBeVisible();

  // Tests tab -> add a "status equals 200" assertion -> save.
  await page.getByText('Tests', { exact: true }).click();
  await expect(page.getByTestId('assertions-editor')).toBeVisible();
  await page.getByTestId('assertion-add').click();
  await page.getByTestId('assertion-expected-0').fill('200');
  await page.getByTestId('save-request-button').click();
  await expect(page.getByText('Request saved.')).toBeVisible();

  // Send the request; the response pane must show the passing assertion.
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('assertions-summary')).toBeVisible();
  await expect(page.getByTestId('assertions-summary')).toContainText('Assertions 1/1 passed');
  await expect(page.getByTestId('assertions-results')).toContainText('status eq 200: actual 200');

  // Run the whole collection from the sidebar.
  await page.getByTestId('collection-Mock API Demo').hover();
  await page.getByTestId('collection-options-Mock API Demo').click();
  await page.getByTestId('run-collection-Mock API Demo').click();
  await expect(page.getByTestId('collection-runner-modal')).toBeVisible();
  await expect(page.getByTestId('collection-run-summary')).toBeVisible();
  await expect(page.getByTestId('collection-run-summary')).toContainText('Requests: 8');
  await expect(page.getByTestId('collection-run-list')).toContainText('GET all posts');
  await expect(page.getByTestId('collection-run-GET all posts')).toContainText('200');
  await page.getByTestId('collection-runner-done').click();
  await expect(page.getByTestId('collection-runner-modal')).not.toBeVisible();
});
