import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

async function setup(page: import('@playwright/test').Page) {
  await signupFreshUser(page);

  const wsRes = await page.request.get('/api/workspaces');
  const ws = (await wsRes.json()).workspaces.find(
    (w: { id: string; name: string }) => w.name === 'My Workspace'
  );
  const content = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
  const projectId = content.projects.find(
    (p: { id: string; name: string }) => p.name === 'Default Project'
  ).id;
  const colName = `rename-col-${Date.now()}`;
  const colRes = await page.request.post('/api/collections', {
    data: { projectId, name: colName },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId(`collection-${colName}`)).toBeVisible();

  return { ws, collectionId, colName };
}

test('rename a collection from the options menu and persist', async ({ page }) => {
  const { ws, collectionId, colName } = await setup(page);

  await page.getByTestId(`collection-options-${colName}`).click();
  await page.getByTestId(`rename-collection-${colName}`).click();
  const renameInput = page.getByTestId(`rename-collection-input-${colName}`);
  await expect(renameInput).toBeVisible();
  const newName = `${colName}-renamed`;
  await renameInput.fill(newName);
  await page.keyboard.press('Enter');

  await expect(page.getByTestId(`collection-${newName}`)).toBeVisible();
  await expect(page.getByTestId(`collection-${colName}`)).toHaveCount(0);

  await expect
    .poll(async () => {
      const t = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
      return t.collections.find((c: { id: string }) => c.id === collectionId)?.name;
    })
    .toBe(newName);
});

test('rename a workspace from the chip actions and persist', async ({ page }) => {
  await signupFreshUser(page);
  const created = await page.request.post('/api/workspaces', {
    data: { name: 'Chip Rename Target' },
  });
  expect(created.status()).toBe(201);
  const workspaceId = (await created.json()).workspace.id;

  await page.goto('/');
  await expect(page.getByTestId('workspace-Chip Rename Target')).toBeVisible();

  await page.getByTestId('workspace-Chip Rename Target').hover();
  await page.getByTestId('rename-workspace-Chip Rename Target').click();
  const renameInput = page.getByTestId('rename-workspace-input-Chip Rename Target');
  await expect(renameInput).toBeVisible();
  await renameInput.fill('Chip Renamed');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('workspace-Chip Renamed')).toBeVisible();
  await expect(page.getByTestId('workspace-Chip Rename Target')).toHaveCount(0);

  await expect
    .poll(async () => {
      const list = await (await page.request.get('/api/workspaces')).json();
      return list.workspaces.find((w: { id: string }) => w.id === workspaceId)?.name;
    })
    .toBe('Chip Renamed');
});
