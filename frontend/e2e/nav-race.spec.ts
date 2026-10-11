import { test, expect } from '@playwright/test';

/**
 * Regression: clicking "APIs" (goWorkspace) while a /manage navigation is
 * still in flight must land back on '/'. goWorkspace() always pushes '/';
 * previously it skipped the push when usePathname() still reported '/', so the
 * pending /manage navigation won and the screen stayed on the manage page.
 */
test('rail-apis during /manage transition still returns to the workspace', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.getByTestId('workspace-My Workspace').click();
  await page.getByTestId('sidebar-request-GET all posts').click();
  await expect(page.getByTestId('url-input')).toBeVisible();

  // Click the Manage rail then IMMEDIATELY the APIs rail, without waiting for
  // the /manage route to settle.
  await page.getByTestId('rail-manage').click();
  await page.getByTestId('rail-apis').click({ delay: 0 });

  await page.waitForTimeout(2000);
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('workspace-My Workspace')).toBeVisible();
  await expect(page.getByTestId('url-input')).toBeVisible();
});
