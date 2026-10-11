import { test, expect } from '@playwright/test';

/**
 * Share links for requests (backlog item #7):
 *  - the "Share" button in the request bar opens the share modal
 *  - a share URL is generated, copyable and revocable
 *  - the public /s/:token page shows the request read-only + latest response
 *    without requiring login.
 *
 * Self-contained: creates a throwaway request (pointed at the mock upstream on
 * :3999), shares it, opens the public page, then revokes + deletes it, so the
 * suite stays green regardless of ordering (other specs mutate "GET all posts").
 */
test('create a share link, open it publicly, and revoke it', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Create a throwaway request via API inside the seeded collection.
  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const content = (await (await page.request.get(`/api/workspaces/${myWs.id}/content`)).json()) as {
    projects: Array<{ id: string }>;
    collections: Array<{ id: string; name: string }>;
  };
  const project = content.projects[0];
  const col = (await (
    await page.request.post('/api/collections', { data: { projectId: project.id, name: 'Share E2E col' } })
  ).json()) as { collection: { id: string } };
  const requestName = `Share E2E ${Date.now()}`;
  const req = (await (
    await page.request.post('/api/requests', {
      data: { collectionId: col.collection.id, name: requestName, method: 'GET', url: 'http://127.0.0.1:3999/posts/1' },
    })
  ).json()) as { request: { id: string } };

  // The sidebar tree predates the API-created request; reload so it is
  // refetched, then select it and run it so the share page has a response.
  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('request-configurator')).toBeVisible();
  await page.getByTestId(`sidebar-request-${requestName}`).click();
  await expect(page.getByTestId('url-input')).toBeVisible();
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');

  // Open the share modal and grab the URL.
  await page.getByTestId('share-open-button').click();
  await expect(page.getByTestId('share-links-modal')).toBeVisible();
  const urlInput = page.getByTestId('share-url-input');
  await expect(urlInput).toBeVisible();
  const shareUrl = await urlInput.inputValue();
  expect(shareUrl).toMatch(/^http:\/\/127\.0\.0\.1:3000\/s\/[0-9a-f-]+$/);

  // The share view is login-gated: a fresh context first sees the sign-in CTA,
  // then the item once any account signs in.
  const anonContext = await page.context().browser()!.newContext();
  const anonPage = await anonContext.newPage();
  await anonPage.goto(shareUrl);
  await expect(anonPage.getByTestId('share-login-required')).toBeVisible();
  // Sign in through the context's request API (its cookie jar is shared with
  // the pages in the context), then reload into the authenticated share view.
  const loginRes = await anonContext.request.post('http://127.0.0.1:3000/api/auth/login', {
    data: { email: 'boss1785867669@test.io', password: 'bosspass123' },
  });
  expect(loginRes.ok()).toBeTruthy();
  await anonPage.reload();
  await expect(anonPage.locator('.share-card')).toBeVisible();
  await expect(anonPage.locator('.share-card')).toContainText(requestName);
  await expect(anonPage.locator('.share-card')).toContainText('127.0.0.1:3999/posts/1');
  await expect(anonPage.locator('.share-card')).toContainText('Latest response');
  await expect(anonPage.locator('.status-chip')).toContainText('200');
  await anonContext.close();

  // Revoke from the modal.
  await page.getByTestId('share-revoke-button').click();
  await expect(page.getByTestId('share-url-input')).not.toBeVisible();

  // The link is now dead.
  const anon2Context = await page.context().browser()!.newContext();
  const anon2Page = await anon2Context.newPage();
  await anon2Context.request.post('http://127.0.0.1:3000/api/auth/login', {
    data: { email: 'boss1785867669@test.io', password: 'bosspass123' },
  });
  await anon2Page.goto(shareUrl);
  await expect(anon2Page.locator('.share-card')).toContainText('Link unavailable');
  await anon2Context.close();

  // Clean up the throwaway request + collection.
  await page.request.delete(`/api/requests/${req.request.id}`);
  await page.request.delete(`/api/collections/${col.collection.id}`);
});
