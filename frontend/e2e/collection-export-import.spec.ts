import { test, expect } from '@playwright/test';
import fs from 'node:fs';

/**
 * BACKLOG #6 — Export / import collections.
 *
 * Logs in as the seeded admin, creates a throwaway collection with two known
 * requests via the API, exports it from the UI as JSON (a real file download),
 * imports that file back under a fresh name, verifies it lands in the sidebar
 * tree with its requests, then deletes both collections so the shared seeded
 * DB stays clean for the rest of the e2e run.
 */
test('exports a collection as JSON and imports it back under a new name', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('open-import-export')).toBeVisible();

  // ---- Create a throwaway collection with two known requests via the API ----
  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const content = (await (await page.request.get(`/api/workspaces/${myWs.id}/content`)).json()) as {
    projects: Array<{ id: string; name: string }>;
  };
  const project = content.projects.find((p) => p.name === 'Default Project')!;

  const suffix = Date.now();
  const sourceName = `Export source ${suffix}`;
  const sourceRes = await page.request.post('/api/collections', {
    data: { projectId: project.id, name: sourceName },
  });
  expect(sourceRes.ok()).toBeTruthy();
  const { collection: source } = (await sourceRes.json()) as {
    collection: { id: string; name: string };
  };
  for (const [name, method] of [
    [`Export alpha ${suffix}`, 'GET'],
    [`Export beta ${suffix}`, 'POST'],
  ] as const) {
    const r = await page.request.post('/api/requests', {
      data: {
        collectionId: source.id,
        name,
        method,
        url: 'http://127.0.0.1:3999/posts',
        apiType: 'REST',
      },
    });
    expect(r.ok()).toBeTruthy();
  }

  // ---- Export it as JSON via the UI ---------------------------------------
  // The tree was loaded before the API-created collection existed, so re-select
  // the workspace to refetch the tree and surface the new collection.
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId(`collection-${sourceName}`)).toBeVisible();
  // Collapse the source collection so its requests (identical names to the
  // imported copy) don't collide in the tree assertions below.
  await page.getByTestId(`collection-${sourceName}`).click();
  await page.getByTestId('open-import-export').click();
  await expect(page.getByTestId('collection-import-export-modal')).toBeVisible();
  await page.getByTestId('ie-export-collection').selectOption({ value: source.id });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('ie-export-download').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const exported = JSON.parse(fs.readFileSync(downloadPath!, 'utf8'));
  expect(exported.format).toBe('api-hub-collection');
  expect(exported.name).toBe(sourceName);
  expect(exported.requests).toHaveLength(2);
  expect(exported.requests.map((r: { name: string }) => r.name).sort()).toEqual([
    `Export alpha ${suffix}`,
    `Export beta ${suffix}`,
  ]);
  await expect(page.getByTestId('toast')).toContainText('Exported');

  // ---- Import it back under a fresh name -----------------------------------
  const importedName = `Imported Demo ${suffix}`;
  await page.getByTestId('ie-tab-import').click();
  await expect(page.getByTestId('ie-import-pane')).toBeVisible();
  await page.getByTestId('ie-import-file').setInputFiles({
    name: 'export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByTestId('ie-import-summary')).toContainText('2 requests');
  await page.getByTestId('ie-import-name').fill(importedName);
  await page.getByTestId('ie-import-project').selectOption({ value: project.id });
  await page.getByTestId('ie-import-confirm').click();

  await expect(page.getByTestId('collection-import-export-modal')).not.toBeVisible();
  await expect(page.getByTestId('toast')).toContainText('Imported');

  // The imported collection appears in the tree, expanded by default with its
  // requests (the source collection stays collapsed, so names are unique).
  await expect(page.getByTestId(`collection-${importedName}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar-request-Export alpha ${suffix}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar-request-Export beta ${suffix}`)).toBeVisible();

  // ---- Clean up both collections so the shared DB stays clean ---------------
  const updated = (await (await page.request.get(`/api/workspaces/${myWs.id}/content`)).json()) as {
    collections: Array<{ id: string; name: string }>;
  };
  const imported = updated.collections.find((c) => c.name === importedName);
  if (imported) {
    expect((await page.request.delete(`/api/collections/${imported.id}`)).ok()).toBeTruthy();
  }
  expect((await page.request.delete(`/api/collections/${source.id}`)).ok()).toBeTruthy();
});
