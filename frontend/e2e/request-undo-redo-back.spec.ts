import { test, expect, Page } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * Request-level navigation and edit history:
 * - Undo / Redo revert and restore the active request's unsaved working-copy
 *   edits (per open request; survives tab switches; cleared by Save only in the
 *   sense that the baseline moves).
 * - Back returns to the previously active request in activation order and
 *   reopens a closed request's tab with its working copy intact.
 * - Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z map to the same operations but only fire
 *   when focus is not on an editable element (native undo keeps working in
 *   text fields / code editors).
 */

async function makeRequest(page: Page, collectionId: string, name: string, url: string) {
  const res = await page.request.post('/api/requests', {
    data: { collectionId, name, method: 'GET', url },
  });
  expect(res.status()).toBe(201);
}

async function openFromSidebar(page: Page, name: string) {
  await page.getByTestId(`sidebar-request-${name}`).click();
  await expect(page.getByTestId(`request-tab-${name}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-switch-${name}`)).toHaveAttribute('aria-selected', 'true');
}

test('back button returns to the previously active request in activation order', async ({ page }) => {
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
    data: { projectId, name: `back-col-${email}` },
  });
  const collectionId = (await colRes.json()).collection.id;

  const nameA = `back-a-${email}`;
  const nameB = `back-b-${email}`;
  const nameC = `back-c-${email}`;
  const names = [nameA, nameB, nameC];
  // The /echo endpoint answers 200 for any path, so "triggering" each request
  // stays deterministic even if earlier specs mutated the shared /posts store.
  for (let i = 0; i < names.length; i++) {
    await makeRequest(
      page,
      collectionId,
      names[i],
      `http://127.0.0.1:3999/echo/posts/${i + 1}`
    );
  }

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const back = page.getByTestId('request-back');
  const undo = page.getByTestId('request-undo');
  const redo = page.getByTestId('request-redo');

  // Open the 1st request and trigger it.
  await openFromSidebar(page, nameA);
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/1/);
  await expect(back).toBeDisabled(); // nothing to go back to yet
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');

  // Open the 2nd request and trigger it.
  await openFromSidebar(page, nameB);
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/2/);
  await expect(back).toBeEnabled(); // A is now the previous request
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');

  // Open the 3rd request and trigger it.
  await openFromSidebar(page, nameC);
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/3/);
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');

  // Back -> the 2nd request (the one that was active before the 3rd).
  await back.click();
  await expect(page.getByTestId(`request-tab-switch-${nameB}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/2/);

  // Back -> the 1st request; history is then exhausted.
  await back.click();
  await expect(page.getByTestId(`request-tab-switch-${nameA}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/1/);
  await expect(back).toBeDisabled();
});

test('undo and redo revert and restore working-copy edits per request', async ({ page }) => {
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
    data: { projectId, name: `undo-col-${email}` },
  });
  const collectionId = (await colRes.json()).collection.id;

  const nameA = `undo-a-${email}`;
  const nameB = `undo-b-${email}`;
  await makeRequest(page, collectionId, nameA, 'http://127.0.0.1:3999/posts/1');
  await makeRequest(page, collectionId, nameB, 'http://127.0.0.1:3999/posts/2');

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const urlInput = page.getByTestId('url-input');
  const undo = page.getByTestId('request-undo');
  const redo = page.getByTestId('request-redo');
  const saveDot = page.getByTestId('save-request-button').locator('.unsaved-dot');

  await openFromSidebar(page, nameA);
  await expect(urlInput).toHaveValue(/\/posts\/1/);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  // Edit -> one undo step (the original value). Dirty dot appears.
  await urlInput.fill('http://127.0.0.1:3999/posts/777');
  await expect(urlInput).toHaveValue(/\/posts\/777/);
  await expect(saveDot).toBeVisible();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  // Undo reverts the working copy; the request is clean again (matches its
  // saved state) so the dirty dot clears.
  await undo.click();
  await expect(urlInput).toHaveValue(/\/posts\/1/);
  await expect(saveDot).toHaveCount(0);
  await expect(undo).toBeDisabled();

  // Redo restores the edit and marks it dirty again.
  await redo.click();
  await expect(urlInput).toHaveValue(/\/posts\/777/);
  await expect(saveDot).toBeVisible();

  // Undo history is preserved across a tab switch and stays per-request: the
  // other request has no history of its own.
  await openFromSidebar(page, nameB);
  await expect(urlInput).toHaveValue(/\/posts\/2/);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.getByTestId(`request-tab-switch-${nameA}`).click();
  await expect(urlInput).toHaveValue(/\/posts\/777/);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(urlInput).toHaveValue(/\/posts\/1/);
});

test('back reopens a closed request tab restoring its unsaved working copy', async ({ page }) => {
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
    data: { projectId, name: `back-reopen-${email}` },
  });
  const collectionId = (await colRes.json()).collection.id;

  const nameA = `back-r-a-${email}`;
  const nameB = `back-r-b-${email}`;
  await makeRequest(page, collectionId, nameA, 'http://127.0.0.1:3999/posts/1');
  await makeRequest(page, collectionId, nameB, 'http://127.0.0.1:3999/posts/2');

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const urlInput = page.getByTestId('url-input');
  const back = page.getByTestId('request-back');

  await openFromSidebar(page, nameA);
  // Unsaved edit on A.
  await urlInput.fill('http://127.0.0.1:3999/posts/999');
  await expect(page.getByTestId(`request-tab-switch-${nameA}`).locator('.unsaved-dot')).toBeVisible();

  // Open B (A becomes the previous request).
  await openFromSidebar(page, nameB);

  // Close A's tab (confirm the unsaved-changes prompt).
  page.once('dialog', (d) => d.accept());
  await page.getByTestId(`request-tab-close-${nameA}`).click();
  await expect(page.getByTestId(`request-tab-${nameA}`)).toHaveCount(0);
  await expect(page.getByTestId(`request-tab-switch-${nameB}`)).toHaveAttribute('aria-selected', 'true');

  // Back reopens A at its original position with the unsaved edit intact.
  await expect(back).toBeEnabled();
  await back.click();
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-${nameB}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-switch-${nameA}`)).toHaveAttribute('aria-selected', 'true');
  await expect(urlInput).toHaveValue(/\/posts\/999/);
  await expect(page.getByTestId(`request-tab-switch-${nameA}`).locator('.unsaved-dot')).toBeVisible();
});

test('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo when not editing a text field', async ({ page }) => {
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
    data: { projectId, name: `keys-col-${email}` },
  });
  const collectionId = (await colRes.json()).collection.id;

  const name = `keys-a-${email}`;
  await makeRequest(page, collectionId, name, 'http://127.0.0.1:3999/posts/1');

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const urlInput = page.getByTestId('url-input');
  const undo = page.getByTestId('request-undo');
  const redo = page.getByTestId('request-redo');
  // Focus a non-editable control (the request's own tab switch — clicking an
  // already-active tab is a no-op) so the app-level shortcuts can fire without
  // accidentally triggering the Send button.
  const focusNeutral = async () => {
    await page.getByTestId(`request-tab-switch-${name}`).click();
  };

  await openFromSidebar(page, name);
  await urlInput.fill('http://127.0.0.1:3999/posts/555');
  await expect(urlInput).toHaveValue(/\/posts\/555/);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  // Ctrl+Z undoes the last edit (focus is on a non-editable control).
  await focusNeutral();
  await page.keyboard.press('Control+z');
  await expect(urlInput).toHaveValue(/\/posts\/1/);
  await expect(undo).toBeDisabled();

  // Ctrl+Shift+Z redoes.
  await focusNeutral();
  await page.keyboard.press('Control+Shift+z');
  await expect(urlInput).toHaveValue(/\/posts\/555/);

  // Ctrl+Z then Ctrl+Y behaves like undo then redo.
  await focusNeutral();
  await page.keyboard.press('Control+z');
  await expect(urlInput).toHaveValue(/\/posts\/1/);
  await focusNeutral();
  await page.keyboard.press('Control+y');
  await expect(urlInput).toHaveValue(/\/posts\/555/);
  await expect(redo).toBeDisabled();

  // While focus is inside the URL text field the shortcut must NOT fire the
  // app-level undo (that stays reserved for the field/browser's own undo, which
  // may or may not revert the text). If the app-level undo had fired it would
  // have moved the request onto the redo stack, so `redo` staying disabled (and
  // `undo` still enabled) proves the guard works.
  await expect(undo).toBeEnabled();
  await urlInput.click();
  await page.keyboard.press('Control+z');
  await expect(redo).toBeDisabled();
  await expect(undo).toBeEnabled();
});
