import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M11: duplicate a request (context-menu button, Ctrl/Cmd+C) and duplicate a
 * folder (folder action button, Ctrl/Cmd+C) — including its whole subtree.
 */
test('duplicate a request via context menu, Ctrl+C and not while typing', async ({ page }) => {
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
    data: { projectId, name: 'Dup Col' },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;

  const reqName = `dup-req-${email}`;
  const reqRes = await page.request.post('/api/requests', {
    data: { collectionId, name: reqName, method: 'GET', url: 'http://127.0.0.1:3999/posts' },
  });
  expect(reqRes.status()).toBe(201);

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const reqRows = page.getByTestId(`sidebar-request-${reqName}`);
  await expect(reqRows).toHaveCount(1);

  // 1. Duplicate via the row context menu.
  await page.getByTestId(`sidebar-row-${reqName}`).hover();
  await page.getByTestId(`request-options-${reqName}`).click();
  await page.getByTestId(`request-duplicate-${reqName}`).click();
  await expect(page.getByTestId('toast')).toContainText(`Duplicated "${reqName}"`);
  await expect(reqRows).toHaveCount(2);

  // 2. Select a row and duplicate it with Ctrl+C.
  await reqRows.first().click();
  await expect(page.getByTestId('url-input')).toBeVisible();
  await expect(page.getByTestId(`sidebar-row-${reqName}`).first()).toHaveClass(/selected/);
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+c');
  await expect(reqRows).toHaveCount(3);

  // 3. Ctrl+C while typing in an input must not duplicate.
  await page.getByTestId('url-input').click();
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(300);
  await expect(reqRows).toHaveCount(3);
});

test('duplicate a folder (with its requests) via the folder button and Ctrl+C', async ({ page }) => {
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
    data: { projectId, name: 'Dup Folder Col' },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;

  const folderName = `dup-folder-${email}`;
  const folderRes = await page.request.post('/api/folders', {
    data: { collectionId, name: folderName },
  });
  expect(folderRes.status()).toBe(201);
  const folderId = (await folderRes.json()).folder.id;

  const innerName = `dup-inner-${email}`;
  const innerRes = await page.request.post('/api/requests', {
    data: {
      collectionId,
      name: innerName,
      method: 'GET',
      url: 'http://127.0.0.1:3999/posts',
      folderId,
    },
  });
  expect(innerRes.status()).toBe(201);

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const folderBtns = page.getByTestId(`folder-${folderName}`);
  const innerRows = page.getByTestId(`sidebar-request-${innerName}`);
  await expect(folderBtns).toHaveCount(1);
  await expect(innerRows).toHaveCount(1);

  // 1. Duplicate the folder via its action menu — the request inside is
  //    copied along with it (same names, so row count doubles).
  await page.getByTestId(`folder-${folderName}`).hover();
  await page.getByTestId(`folder-options-${folderName}`).click();
  await page.getByTestId(`duplicate-folder-${folderName}`).click();
  await expect(page.getByTestId('toast')).toContainText(`Duplicated "${folderName}"`);
  await expect(folderBtns).toHaveCount(2);
  await expect(innerRows).toHaveCount(2);

  // 2. Select the original folder and duplicate it with Ctrl+C.
  await folderBtns.first().click();
  await expect(
    page.locator('.tree-folder-row.selected', { has: folderBtns.first() })
  ).toHaveCount(1);
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+c');
  await expect(page.getByTestId('toast')).toContainText(`Duplicated "${folderName}"`);
  await expect(folderBtns).toHaveCount(3);
});
