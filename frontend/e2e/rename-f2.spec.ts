import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M12: pressing F2 on a selected request or folder row in the sidebar tree
 * starts the existing inline rename (Enter commits, Escape cancels). F2 must
 * not fire while the focus is in a text input (rename input, URL field).
 */

async function setupWorkspace(page: import('@playwright/test').Page) {
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
    data: { projectId, name: 'Rename F2 Col' },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;

  const folderName = `f2-folder-${email}`;
  const folderRes = await page.request.post('/api/folders', {
    data: { collectionId, name: folderName },
  });
  expect(folderRes.status()).toBe(201);
  const folderId = (await folderRes.json()).folder.id;

  const reqName = `f2-req-${email}`;
  const reqRes = await page.request.post('/api/requests', {
    data: {
      collectionId,
      name: reqName,
      method: 'GET',
      url: 'http://127.0.0.1:3999/posts',
      folderId,
    },
  });
  expect(reqRes.status()).toBe(201);
  const requestId = (await reqRes.json()).request.id;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  return { email, ws, requestId, folderId, folderName, reqName };
}

test('rename a selected request with F2 (Escape cancels, Enter commits and persists)', async ({ page }) => {
  const { ws, requestId, reqName } = await setupWorkspace(page);

  // Select the request row (this also opens it) and press F2.
  await page.getByTestId(`sidebar-request-${reqName}`).click();
  await expect(page.getByTestId('url-input')).toBeVisible();
  await expect(page.getByTestId(`sidebar-row-${reqName}`)).toHaveClass(/selected/);
  await page.keyboard.press('F2');
  const renameInput = page.getByTestId(`rename-input-${reqName}`);
  await expect(renameInput).toBeVisible();

  // Escape cancels the rename without changes.
  await page.keyboard.press('Escape');
  await expect(renameInput).toHaveCount(0);
  await expect(page.getByTestId(`sidebar-request-${reqName}`)).toBeVisible();

  // F2 again, type a new name and commit with Enter.
  await page.keyboard.press('F2');
  await expect(renameInput).toBeVisible();
  const newName = `${reqName}-renamed`;
  await renameInput.fill(newName);
  await page.keyboard.press('Enter');

  // The renamed row replaces the old one in the sidebar.
  await expect(page.getByTestId(`rename-input-${reqName}`)).toHaveCount(0);
  await expect(page.getByTestId(`sidebar-request-${newName}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar-request-${reqName}`)).toHaveCount(0);

  // The stored name is updated via the API.
  await expect
    .poll(async () => {
      const t = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
      return t.requests.find((r: { id: string }) => r.id === requestId)?.name;
    })
    .toBe(newName);
});

test('rename a selected folder with F2 (Enter commits and persists)', async ({ page }) => {
  const { ws, folderId, folderName } = await setupWorkspace(page);

  // Clicking a folder row selects it (and toggles the folder).
  await page.getByTestId(`folder-${folderName}`).click();
  await expect(page.locator('.tree-folder-row.selected', { has: page.getByTestId(`folder-${folderName}`) })).toHaveCount(1);
  await page.keyboard.press('F2');
  const renameInput = page.getByTestId(`rename-folder-input-${folderName}`);
  await expect(renameInput).toBeVisible();

  const newName = `${folderName}-renamed`;
  await renameInput.fill(newName);
  await page.keyboard.press('Enter');

  await expect(renameInput).toHaveCount(0);
  await expect(page.getByTestId(`folder-${newName}`)).toBeVisible();
  await expect(page.getByTestId(`folder-${folderName}`)).toHaveCount(0);

  await expect
    .poll(async () => {
      const t = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
      return t.folders.find((f: { id: string }) => f.id === folderId)?.name;
    })
    .toBe(newName);
});

test('F2 does not start a rename while typing in the URL input', async ({ page }) => {
  const { reqName } = await setupWorkspace(page);

  await page.getByTestId(`sidebar-request-${reqName}`).click();
  await expect(page.getByTestId('url-input')).toBeVisible();

  // Focus the URL field and press F2 — nothing may happen.
  await page.getByTestId('url-input').click();
  await page.keyboard.press('F2');
  await page.waitForTimeout(300);
  await expect(page.getByTestId(`rename-input-${reqName}`)).toHaveCount(0);
});
