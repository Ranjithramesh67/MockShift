import { test, expect } from '@playwright/test';

/**
 * Run history page (backlog item #3), with the privacy rule that each user
 * only sees their OWN runs — never another user's or team-wide history.
 *
 * Depends on the seed data created by `cd backend && npm run seed:dev`
 * (ADMIN account, "My Workspace", "Mock API Demo" collection on :3999).
 */
test('a user sees their own run in the run history page with snapshots', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Create a uniquely-named request (idempotent) so the run is deterministic
  // in the shared dev DB even when the suite is re-run without a reset.
  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const content = (await (await page.request.get(`/api/workspaces/${myWs.id}/content`)).json()) as {
    projects: Array<{ id: string; name: string }>;
    collections: Array<{ id: string; name: string; project_id: string }>;
    requests: Array<{ id: string; name: string; collection_id: string }>;
  };
  const demoCol = content.collections.find((c) => c.name === 'Mock API Demo')!;
  for (const r of content.requests.filter((x) => x.name === 'history-e2e-request')) {
    await page.request.delete(`/api/requests/${r.id}`);
  }
  const reqRes = await page.request.post('/api/requests', {
    data: {
      collectionId: demoCol.id,
      name: 'history-e2e-request',
      method: 'GET',
      url: 'http://127.0.0.1:3999/posts',
    },
  });
  expect(reqRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('workspace-My Workspace').click();
  await page.getByTestId('sidebar-request-history-e2e-request').click();
  await expect(page.getByTestId('url-input')).toBeVisible();
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-pane')).toBeVisible();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');

  // Open the run history via the rail (in-app, same shell).
  await page.getByTestId('rail-history').click();
  await expect(page.getByTestId('history-page')).toBeVisible();

  const runRow = page.getByTestId('history-run-history-e2e-request');
  await expect(runRow).toBeVisible();
  await expect(runRow).toContainText('SUCCESS');
  await expect(runRow).toContainText('http://127.0.0.1:3999/posts');

  // Open the run detail and check the request/response snapshots.
  await page.getByTestId('history-detail-history-e2e-request').click();
  await expect(page.getByTestId('history-detail-modal')).toBeVisible();
  await expect(page.getByTestId('history-detail-name')).toHaveText('history-e2e-request');
  await expect(page.getByTestId('history-request-snapshot')).toContainText('GET');
  await expect(page.getByTestId('history-response-snapshot')).toContainText('Status: 200');
  await page.getByTestId('history-detail-close').click();
  await expect(page.getByTestId('history-detail-modal')).not.toBeVisible();
});

test('another user never sees someone elses run history', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('dev1785867669@test.io');
  await page.getByTestId('login-password').fill('devpass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Dev has never executed a request, so their history is empty even though
  // the boss has plenty of runs in the same dev DB.
  await page.getByTestId('rail-history').click();
  await expect(page.getByTestId('history-page')).toBeVisible();
  await expect(page.getByTestId('history-empty')).toBeVisible();
  await expect(page.getByTestId('history-list')).not.toContainText('history-e2e-request');
});
