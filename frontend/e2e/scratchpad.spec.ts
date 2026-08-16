import { test, expect } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * M8: scratchpad — test a cURL command without saving.
 * - TopBar "Test cURL" opens the scratchpad modal
 * - pasting a curl command shows a structured preview (method + URL)
 * - Send executes it via POST /api/runs (no history), no request is created
 * - the response is shown in ResponsePane
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

  // Open the scratchpad and paste a cURL command.
  await page.getByTestId('topbar-test-curl').click();
  await expect(page.getByTestId('scratchpad-modal')).toBeVisible();
  await page.getByTestId('scratchpad-input').fill(
    `curl -X POST 'http://127.0.0.1:3999/posts' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"title":"scratch"}'`
  );

  // Structured preview shows method + URL.
  const preview = page.getByTestId('scratchpad-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('POST');
  await expect(preview).toContainText('http://127.0.0.1:3999/posts');
  await expect(preview).toContainText('Headers (1)');

  // Send runs it and shows the response in ResponsePane.
  await page.getByTestId('scratchpad-send').click();
  await expect(page.getByTestId('scratchpad-modal')).toHaveCount(0);
  const responseBody = page.locator('.response-pane .cm-content');
  await expect(responseBody).toContainText('"title": "scratch"');
  await expect(page.getByTestId('response-pane')).toContainText('201');

  // No request was created in the collection.
  const after = await (await page.request.get(`/api/workspaces/${ws.id}/content`)).json();
  expect(
    after.requests.filter((r: { collection_id: string }) => r.collection_id === collectionId)
  ).toHaveLength(0);
});

/** Pasting non-curl text shows a helpful hint and Send reports the error. */
test('scratchpad rejects text that is not a cURL command', async ({ page }) => {
  const email = await signupFreshUser(page);

  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.getByTestId('topbar-test-curl').click();
  await page.getByTestId('scratchpad-input').fill('just some plain text, not curl');
  await expect(page.getByTestId('scratchpad-preview')).toContainText('Paste a curl command');

  await page.getByTestId('scratchpad-send').click();
  await expect(page.getByTestId('scratchpad-error')).toContainText('Could not find a URL');
  await expect(page.getByTestId('scratchpad-modal')).toBeVisible();
});
