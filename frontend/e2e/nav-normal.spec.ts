import { test, expect } from '@playwright/test';

/**
 * Sanity: clicking a request while already on '/' must open the editor with
 * the request loaded and must NOT trigger a full page reload (which would
 * clear the sidebar tree state). goWorkspace() always pushes '/'; pushing the
 * current route must be a no-op navigation.
 */
test('clicking a request while on the workspace keeps state and loads the request', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('workspace-My Workspace')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);

  await page.getByTestId('workspace-My Workspace').click();
  const req = page.getByTestId('sidebar-request-GET all posts');
  await expect(req).toBeVisible();

  // Track full-page navigations; a router.push('/') from '/' must not reload.
  let loads = 0;
  page.on('load', () => { loads += 1; });

  await req.click();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('url-input')).toHaveValue(/posts/);
  expect(loads).toBe(0);
});
