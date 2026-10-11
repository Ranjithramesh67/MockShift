import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M7: browser-style tabs for opened requests.
 * - opening a request adds a tab (dedupe); the active tab is highlighted
 * - switching tabs preserves the working copy (unsaved edits survive)
 * - a dirty tab shows the unsaved-changes dot
 * - closing a dirty tab asks for confirmation (dismiss keeps it)
 * - closing the active tab activates a neighbour; closing the last tab
 *   hides the strip
 */
test('request tabs: switch preserves working copy, dirty dot, close neighbour', async ({ page }) => {
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
    data: { projectId, name: 'Tabs Col' },
  });
  const collectionId = (await colRes.json()).collection.id;

  const nameA = `tabs-a-${email}`;
  const nameB = `tabs-b-${email}`;
  const mk = async (name: string, url: string) => {
    const res = await page.request.post('/api/requests', {
      data: { collectionId, name, method: 'GET', url },
    });
    expect(res.status()).toBe(201);
  };
  await mk(nameA, 'http://127.0.0.1:3999/posts/1');
  await mk(nameB, 'http://127.0.0.1:3999/posts/2');

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Open request A -> one tab.
  await page.getByTestId(`sidebar-request-${nameA}`).click();
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-switch-${nameA}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/1/);

  // Open request B -> two tabs, B active.
  await page.getByTestId(`sidebar-request-${nameB}`).click();
  await expect(page.getByTestId(`request-tab-${nameB}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-switch-${nameB}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/2/);

  // Switch to A and edit it -> dirty dot appears on tab A.
  await page.getByTestId(`request-tab-switch-${nameA}`).click();
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/1/);
  await page.getByTestId('url-input').fill('http://127.0.0.1:3999/posts/99');
  const dotA = page.getByTestId(`request-tab-switch-${nameA}`).locator('.unsaved-dot');
  await expect(dotA).toBeVisible();
  await expect(page.getByTestId('unsaved-dot')).toHaveCount(2); // tab A + Save button

  // Switch to B and back -> working copy of A is preserved.
  await page.getByTestId(`request-tab-switch-${nameB}`).click();
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/2/);
  await expect(page.getByTestId('unsaved-dot')).toHaveCount(1); // tab A only
  await page.getByTestId(`request-tab-switch-${nameA}`).click();
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/99/);
  await expect(dotA).toBeVisible();

  // Save clears the dot on the tab (and the Save button).
  await page.getByTestId('save-request-button').click();
  await expect(dotA).toHaveCount(0);

  // Close clean tab B -> A stays, active unchanged (B was not active).
  await page.getByTestId(`request-tab-close-${nameB}`).click();
  await expect(page.getByTestId(`request-tab-${nameB}`)).toHaveCount(0);
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();

  // Closing a dirty tab asks for confirmation; dismiss keeps the tab.
  await page.getByTestId('url-input').fill('http://127.0.0.1:3999/posts/777');
  await expect(dotA).toBeVisible();
  page.once('dialog', (d) => d.dismiss());
  await page.getByTestId(`request-tab-close-${nameA}`).click();
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();

  // Accepting the confirmation closes the last tab and hides the strip.
  page.once('dialog', (d) => d.accept());
  await page.getByTestId(`request-tab-close-${nameA}`).click();
  await expect(page.getByTestId(`request-tab-${nameA}`)).toHaveCount(0);
  await expect(page.getByTestId('request-tabs')).toHaveCount(0);
});

/**
 * Closing the active tab activates a neighbour (the tab to its right, else
 * the one to its left).
 */
test('request tabs: closing the active tab activates a neighbour', async ({ page }) => {
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
    data: { projectId, name: 'Tabs Neighbour Col' },
  });
  const collectionId = (await colRes.json()).collection.id;

  const nameA = `tabs-n-a-${email}`;
  const nameB = `tabs-n-b-${email}`;
  const nameC = `tabs-n-c-${email}`;
  for (const [name, id] of [
    [nameA, 1],
    [nameB, 2],
    [nameC, 3],
  ] as const) {
    const res = await page.request.post('/api/requests', {
      data: { collectionId, name, method: 'GET', url: `http://127.0.0.1:3999/posts/${id}` },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Open A, B, C in order. Active = C.
  for (const name of [nameA, nameB, nameC]) {
    await page.getByTestId(`sidebar-request-${name}`).click();
    await expect(page.getByTestId(`request-tab-${name}`)).toBeVisible();
  }
  await expect(page.getByTestId(`request-tab-switch-${nameC}`)).toHaveAttribute('aria-selected', 'true');

  // Close active C -> B (the tab to its left, since C was last) activates.
  await page.getByTestId(`request-tab-close-${nameC}`).click();
  await expect(page.getByTestId(`request-tab-${nameC}`)).toHaveCount(0);
  await expect(page.getByTestId(`request-tab-switch-${nameB}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/2/);

  // Close active B -> A (neighbour to the right of A now) activates.
  await page.getByTestId(`request-tab-close-${nameB}`).click();
  await expect(page.getByTestId(`request-tab-switch-${nameA}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/1/);
});

/**
 * Ctrl+Q closes the active request tab (instead of a browser-reserved combo
 * like Ctrl+F4 that would close the whole app tab); Ctrl+Shift+Q reopens the
 * most recently closed tab with its working copy restored. Dirty tabs ask for
 * confirmation first, matching the close (×) button.
 */
test('request tabs: Ctrl+Q closes the active request tab; Ctrl+Shift+Q reopens it', async ({ page }) => {
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
    data: { projectId, name: 'Tabs CtrlQ Col' },
  });
  const collectionId = (await colRes.json()).collection.id;

  const nameA = `tabs-q-a-${email}`;
  const nameB = `tabs-q-b-${email}`;
  for (const [name, id] of [
    [nameA, 1],
    [nameB, 2],
  ] as const) {
    const res = await page.request.post('/api/requests', {
      data: { collectionId, name, method: 'GET', url: `http://127.0.0.1:3999/posts/${id}` },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Open A and B; B is active.
  await page.getByTestId(`sidebar-request-${nameA}`).click();
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();
  await page.getByTestId(`sidebar-request-${nameB}`).click();
  await expect(page.getByTestId(`request-tab-${nameB}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-switch-${nameB}`)).toHaveAttribute('aria-selected', 'true');

  // Ctrl+Q closes B (the active request tab) and activates A. The app (page)
  // itself stays alive — verify A's tab strip is still there.
  await page.keyboard.press('Control+q');
  await expect(page.getByTestId(`request-tab-${nameB}`)).toHaveCount(0);
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-switch-${nameA}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/1/);

  // Make A dirty; Ctrl+Q asks for confirmation; dismiss keeps the tab open.
  await page.getByTestId('url-input').fill('http://127.0.0.1:3999/posts/777');
  await expect(
    page.getByTestId(`request-tab-switch-${nameA}`).locator('.unsaved-dot')
  ).toBeVisible();
  page.once('dialog', (d) => d.dismiss());
  await page.keyboard.press('Control+q');
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();

  // Accepting the confirmation closes the last tab and hides the strip.
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Control+q');
  await expect(page.getByTestId(`request-tab-${nameA}`)).toHaveCount(0);
  await expect(page.getByTestId('request-tabs')).toHaveCount(0);

  // The app is still usable after the strip is gone.
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Ctrl+Shift+Q reopens the last closed tab (A) at its original position,
  // restoring its unsaved working copy.
  await page.keyboard.press('Control+Shift+q');
  await expect(page.getByTestId(`request-tab-${nameA}`)).toBeVisible();
  await expect(page.getByTestId(`request-tab-switch-${nameA}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('url-input')).toHaveValue(/\/posts\/777/);
  await expect(
    page.getByTestId(`request-tab-switch-${nameA}`).locator('.unsaved-dot')
  ).toBeVisible();
});

/**
 * The executed response of a request is kept in memory for the lifetime of the
 * page: closing a tab with Ctrl+Q and reopening it with Ctrl+Shift+Q restores
 * the response that was shown before the tab was closed.
 */
test('request tabs: Ctrl+Shift+Q restores the last executed response', async ({ page }) => {
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
    data: { projectId, name: 'Tabs Response Col' },
  });
  const collectionId = (await colRes.json()).collection.id;

  const name = `tabs-resp-${email}`;
  const res = await page.request.post('/api/requests', {
    data: { collectionId, name, method: 'GET', url: 'http://127.0.0.1:3999/posts/1' },
  });
  expect(res.status()).toBe(201);

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Open the request and execute it -> response pane shows the result.
  await page.getByTestId(`sidebar-request-${name}`).click();
  await expect(page.getByTestId(`request-tab-${name}`)).toBeVisible();
  const responseBody = page.locator('.response-pane .cm-content');
  await page.getByTestId('send-button').click();
  await expect(responseBody).toContainText('"id": 1');
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');

  // Ctrl+Q closes the tab; the response pane is replaced by the empty state.
  await page.keyboard.press('Control+q');
  await expect(page.getByTestId(`request-tab-${name}`)).toHaveCount(0);
  await expect(page.getByTestId('response-pane')).toContainText('No response yet.');

  // Ctrl+Shift+Q reopens the tab and restores the executed response.
  await page.keyboard.press('Control+Shift+q');
  await expect(page.getByTestId(`request-tab-${name}`)).toBeVisible();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');
  await expect(responseBody).toContainText('"id": 1');
});
