import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M10: drag-and-drop a request from one folder into another, and back onto the
 * collection root. Uses the native HTML5 DnD path (request rows are
 * `draggable`; folder rows / collection roots are drop targets).
 */
test('drag a request into another folder and back to the collection root', async ({ page }) => {
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
    data: { projectId, name: 'Drag Move Col' },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;

  const folderAName = `drag-a-${email}`;
  const folderBName = `drag-b-${email}`;
  const mkFolder = async (name: string) => {
    const res = await page.request.post('/api/folders', {
      data: { collectionId, name },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).folder.id;
  };
  const folderAId = await mkFolder(folderAName);
  const folderBId = await mkFolder(folderBName);

  const reqName = `drag-req-${email}`;
  const reqRes = await page.request.post('/api/requests', {
    data: {
      collectionId,
      name: reqName,
      method: 'GET',
      url: 'http://127.0.0.1:3999/posts',
      folderId: folderAId,
    },
  });
  expect(reqRes.status()).toBe(201);
  const requestId = (await reqRes.json()).request.id;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // The request starts inside folder A.
  const reqRow = page.getByTestId(`sidebar-request-${reqName}`);
  await expect(reqRow).toBeVisible();
  const folderABlock = page.locator('.tree-folder', { has: page.getByTestId(`folder-${folderAName}`) });
  const folderBBlock = page.locator('.tree-folder', { has: page.getByTestId(`folder-${folderBName}`) });
  await expect(folderABlock.getByTestId(`sidebar-request-${reqName}`)).toBeVisible();
  await expect(folderBBlock.getByTestId(`sidebar-request-${reqName}`)).toHaveCount(0);

  // Drag the request row onto folder B.
  await page.dragAndDrop(
    `[data-testid="sidebar-row-${reqName}"]`,
    `[data-testid="folder-${folderBName}"]`
  );

  // Success toast + the row now lives under folder B.
  await expect(page.getByTestId('toast')).toContainText(`Moved "${reqName}"`);
  await expect(folderBBlock.getByTestId(`sidebar-request-${reqName}`)).toBeVisible();
  await expect(folderABlock.getByTestId(`sidebar-request-${reqName}`)).toHaveCount(0);
  await expect
    .poll(async () => {
      const t = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
      return t.requests.find((r: { id: string }) => r.id === requestId)?.folder_id;
    })
    .toBe(folderBId);

  // Drag it back onto the collection root row -> folder_id becomes null.
  await page.dragAndDrop(
    `[data-testid="sidebar-row-${reqName}"]`,
    `[data-testid="collection-Drag Move Col"]`
  );
  await expect(page.getByTestId('toast')).toContainText(`Moved "${reqName}"`);
  await expect
    .poll(async () => {
      const t = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
      return t.requests.find((r: { id: string }) => r.id === requestId)?.folder_id;
    })
    .toBe(null);
});
