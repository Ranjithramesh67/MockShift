import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M13: drag-and-drop a folder onto another folder (re-parent) and back onto
 * the collection root. Folder rows are the drag source (`draggable`), folder
 * rows / collection roots are drop targets, mirroring the M10 request drag.
 * The client mirrors the backend cycle guard: dropping a folder into itself or
 * one of its descendants is rejected with a warning toast.
 */
test('drag a folder into another folder, to the root, and guard cycles', async ({ page }) => {
  const email = await signupFreshUser(page);

  const wsRes = await page.request.get('/api/workspaces');
  const ws = (await wsRes.json()).workspaces.find(
    (w: { id: string; name: string }) => w.name === 'My Workspace'
  );
  const content = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
  const projectId = content.projects.find(
    (p: { id: string; name: string }) => p.name === 'Default Project'
  ).id;

  const colName = `Drag Move Col ${email}`;
  const colRes = await page.request.post('/api/collections', {
    data: { projectId, name: colName },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;

  const folderAName = `drag-a-${email}`;
  const folderBName = `drag-b-${email}`;
  const folderCName = `drag-c-${email}`;
  const mkFolder = async (name: string, parentId: string | null = null) => {
    const res = await page.request.post('/api/folders', {
      data: parentId ? { collectionId, name, parentId } : { collectionId, name },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).folder.id;
  };
  const folderAId = await mkFolder(folderAName);
  const folderBId = await mkFolder(folderBName);
  const folderCId = await mkFolder(folderCName, folderAId);

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

  const folderState = async (id: string) => {
    const t = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
    return t.folders.find((f: { id: string }) => f.id === id);
  };
  // The draggable element is the `.tree-folder-row` div; its name button is a
  // direct child, so navigate up one level.
  const folderRow = (name: string) =>
    `xpath=//button[@data-testid="folder-${name}"]/parent::div[contains(@class,"tree-folder-row")]`;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Cycle guard: dropping folder A onto its own descendant (C) is rejected
  // client-side with a warning toast and the tree is left unchanged.
  await page.dragAndDrop(folderRow(folderAName), `[data-testid="folder-${folderCName}"]`);
  await expect(page.getByTestId('toast')).toContainText(
    'Cannot move a folder into itself or its subfolder'
  );
  await expect.poll(async () => (await folderState(folderAId)).parent_id).toBe(null);

  // Drag folder C onto folder B -> C moves out from under A into B.
  await page.dragAndDrop(folderRow(folderCName), `[data-testid="folder-${folderBName}"]`);
  await expect(page.getByTestId('toast')).toContainText(`Moved "${folderCName}"`);
  await expect.poll(async () => (await folderState(folderCId)).parent_id).toBe(folderBId);

  // Drag folder B onto folder A -> B becomes nested under A (carrying C).
  await page.dragAndDrop(folderRow(folderBName), `[data-testid="folder-${folderAName}"]`);
  await expect(page.getByTestId('toast')).toContainText(`Moved "${folderBName}"`);
  await expect.poll(async () => (await folderState(folderBId)).parent_id).toBe(folderAId);

  // Drag folder B back onto the collection root row -> parent_id becomes null.
  await page.dragAndDrop(folderRow(folderBName), `[data-testid="collection-${colName}"]`);
  await expect(page.getByTestId('toast')).toContainText(`Moved "${folderBName}"`);
  await expect.poll(async () => (await folderState(folderBId)).parent_id).toBe(null);

  // C rides along with B and is still nested under it.
  await expect.poll(async () => (await folderState(folderCId)).parent_id).toBe(folderBId);
});
