import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M14: scratchpad — full-width editor pane + save location picker.
 * - TopBar "Test cURL" opens the full-width ScratchpadWorkspace pane (not a
 *   modal): method select, URL input, Params/Headers/Body/Formula/Tests tabs,
 *   Send / Save / Close controls, response split below.
 * - pasting a cURL command into the URL input auto-parses method + URL
 * - Send stays ephemeral (POST /api/runs, persistHistory false) — no request
 *   is created
 * - Save opens the ScratchpadSaveModal picker: a required name field plus a
 *   tree of the workspace's collections and nested folders; confirm creates
 *   the request at the picked location and opens its editor
 */
test('scratchpad runs a pasted cURL without creating a request', async ({ page }) => {
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
    data: { projectId, name: 'Scratch Col' },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Open the full-width scratchpad pane and paste a cURL command.
  await page.getByTestId('topbar-test-curl').click();
  await expect(page.getByTestId('scratchpad-workspace')).toBeVisible();
  await page.getByTestId('scratchpad-url').fill(
    `curl -X POST 'http://127.0.0.1:3999/posts' -H 'Content-Type: application/json' --data-raw '{"title":"scratch"}'`
  );

  // The curl auto-parse fills in the method.
  await expect(page.getByTestId('scratchpad-method')).toHaveValue('POST');

  // Send runs it and shows the response in ResponsePane.
  await page.getByTestId('scratchpad-send').click();
  await expect(page.getByTestId('response-pane')).toBeVisible();
  const responseBody = page.locator('.response-pane .cm-content');
  await expect(responseBody).toContainText('"title": "scratch"');
  await expect(page.getByTestId('response-pane')).toContainText('201');

  // No request was created in the collection (Send stays ephemeral).
  const after = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
  expect(
    after.requests.filter((r: { collection_id: string }) => r.collection_id === collectionId)
  ).toHaveLength(0);

  // Close the pane.
  await page.getByTestId('scratchpad-close').click();
  await expect(page.getByTestId('scratchpad-workspace')).toHaveCount(0);
});

/**
 * Save persists the scratchpad request at a chosen collection + nested folder.
 * The picker requires a name; confirming with an empty name keeps the modal
 * open. Picking a folder saves the request into it and opens its editor.
 */
test('scratchpad save picker saves into a nested folder', async ({ page }) => {
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
    data: { projectId, name: 'Scratch Col' },
  });
  expect(colRes.status()).toBe(201);
  const collectionId = (await colRes.json()).collection.id;
  const folderRes = await page.request.post('/api/folders', {
    data: { collectionId, name: 'Sub Folder', parentId: null },
  });
  expect(folderRes.status()).toBe(201);
  const folderId = (await folderRes.json()).folder.id;

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Open the scratchpad, type a plain URL and set GET.
  await page.getByTestId('topbar-test-curl').click();
  await expect(page.getByTestId('scratchpad-workspace')).toBeVisible();
  await page.getByTestId('scratchpad-url').fill('http://127.0.0.1:3999/posts');
  await page.getByTestId('scratchpad-method').selectOption('GET');

  // Save opens the location picker.
  await page.getByTestId('scratchpad-save').click();
  await expect(page.getByTestId('scratchpad-save-modal')).toBeVisible();

  // A name is required: confirming with an empty name fails and stays open.
  await page.getByTestId('scratchpad-save-confirm').click();
  await expect(page.getByTestId('toast')).toBeVisible();
  await expect(page.getByTestId('scratchpad-save-modal')).toBeVisible();

  // Name the request and pick the nested folder, then confirm.
  await page.getByTestId('scratchpad-save-name').fill('Saved From Scratchpad');
  await page.getByTestId(`scratchpad-save-folder-${folderId}`).click();
  await page.getByTestId('scratchpad-save-confirm').click();

  // The request now exists at that folder.
  const after = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
  const saved = after.requests.find(
    (r: { name: string; folder_id: string }) => r.name === 'Saved From Scratchpad'
  );
  expect(saved).toBeTruthy();
  expect(saved.folder_id).toBe(folderId);

  // The pane closes and the request editor opens.
  await expect(page.getByTestId('scratchpad-workspace')).toHaveCount(0);
  await expect(page.getByTestId('request-configurator')).toBeVisible();
});
