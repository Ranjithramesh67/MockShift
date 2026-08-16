import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M6: Send uses the working copy. A clean request runs through the stored
 * endpoint (history persisted and linked to the request); a dirty request
 * (unsaved edits) runs the in-memory working copy via POST /api/runs without
 * persisting history or touching the stored request.
 */
test('Send executes the working copy when dirty and persists history when clean', async ({ page }) => {
  const email = await signupFreshUser(page);

  const wsRes = await page.request.get('/api/workspaces');
  const ws = (await wsRes.json()).workspaces.find(
    (w: { id: string; name: string }) => w.name === 'My Workspace'
  );
  const content = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
  const projectId = content.projects.find(
    (p: { id: string; name: string }) => p.name === 'Default Project'
  ).id;
  const colRes = await page.request.post('/api/collections', {
    data: { projectId, name: 'Send Col' },
  });
  const collectionId = (await colRes.json()).collection.id;
  const reqRes = await page.request.post('/api/requests', {
    data: {
      collectionId,
      name: `send-copy-${email}`,
      method: 'GET',
      url: 'http://127.0.0.1:3999/posts/1',
    },
  });
  expect(reqRes.status()).toBe(201);
  const requestId = (await reqRes.json()).request.id;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId(`sidebar-request-send-copy-${email}`).click();
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/1/);

  const historyCount = async (): Promise<number> => {
    const res = await page.request.get('/api/history?limit=100');
    return (await res.json()).runs.length;
  };

  const responseBody = page.locator('.response-pane .cm-content');

  // Clean send: stored request run -> history row written and linked.
  const before = await historyCount();
  await page.getByTestId('send-button').click();
  await expect(responseBody).toContainText('"id": 1');
  await expect(page.getByTestId('unsaved-dot')).toHaveCount(0);
  expect(await historyCount()).toBe(before + 1);

  // Dirty send: working copy executed (posts/2), no history written, still unsaved.
  await page.getByTestId('url-input').fill('http://127.0.0.1:3999/posts/2');
  await expect(page.getByTestId('unsaved-dot')).toBeVisible();
  await page.getByTestId('send-button').click();
  await expect(responseBody).toContainText('"id": 2');
  await expect(page.getByTestId('unsaved-dot')).toBeVisible();
  expect(await historyCount()).toBe(before + 1);

  // The stored request is untouched: only the working copy was run.
  const stored = await (await page.request.get(`/api/requests/${requestId}`)).json();
  expect(stored.request.url).toBe('http://127.0.0.1:3999/posts/1');
});
