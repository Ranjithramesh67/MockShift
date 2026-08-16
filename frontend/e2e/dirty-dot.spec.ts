import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M4: the unsaved-changes dot. A freshly loaded request is clean; editing any
 * field makes the dot appear on the Save button (title "You have unsaved
 * changes"); clicking Save clears it again.
 */
test('unsaved-changes dot appears on edit and clears on save', async ({ page }) => {
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
    data: { projectId, name: 'Dirty Dot Col' },
  });
  const collectionId = (await colRes.json()).collection.id;
  const reqRes = await page.request.post('/api/requests', {
    data: {
      collectionId,
      name: `dirty-dot-check-${email}`,
      method: 'GET',
      url: 'http://127.0.0.1:3999/posts',
    },
  });
  expect(reqRes.status()).toBe(201);
  const requestId = (await reqRes.json()).request.id;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const req = page.getByTestId(`sidebar-request-dirty-dot-check-${email}`);
  await expect(req).toBeVisible();
  await req.click();
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts/);

  // Clean on load.
  await expect(page.getByTestId('unsaved-dot')).toHaveCount(0);

  // Editing the URL marks the working copy dirty. The dot appears on the Save
  // button (M4) and on the request's tab (M7) — scope to the Save button.
  await page.getByTestId('url-input').fill(`http://127.0.0.1:3999/posts/1?ref=${requestId}`);
  const saveDot = page.getByTestId('save-request-button').locator('.unsaved-dot');
  await expect(saveDot).toBeVisible();
  await expect(saveDot).toHaveAttribute('title', 'You have unsaved changes');

  // Saving clears the dirty flag.
  await page.getByTestId('save-request-button').click();
  await expect(page.getByTestId('unsaved-dot')).toHaveCount(0);
});
