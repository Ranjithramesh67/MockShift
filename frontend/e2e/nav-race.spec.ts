import { test, expect } from '@playwright/test';

/**
 * Regression: clicking a request while the /manage navigation is still in
 * flight. The sidebar's goWorkspace() previously skipped router.push('/')
 * because usePathname() still reported '/', so the pending /manage navigation
 * won and the screen stayed on the manage page.
 */
test('clicking a request during /manage transition still opens the editor', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.getByTestId('workspace-My Workspace').click();
  const req = page.getByTestId('sidebar-request-GET all posts');
  await expect(req).toBeVisible();

  // Click the Manage rail then IMMEDIATELY the request, without waiting for
  // the /manage route to settle.
  await page.getByTestId('rail-manage').click();
  await req.click({ delay: 0 });

  await page.waitForTimeout(2000);
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('url-input')).toBeVisible();
});
