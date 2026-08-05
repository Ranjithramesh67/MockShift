import { test, expect } from '@playwright/test';

/**
 * Regression: opening /manage, /admin or /automations, then clicking any API
 * request in the sidebar must switch back to the workspace and open the
 * request editor. Previously the view stayed on the admin page when the click
 * happened while the top-level navigation was still settling.
 *
 * Depends on the seed data created by `cd backend && npm run seed:dev`
 * (ADMIN account, "My Workspace", "Mock API Demo" collection).
 */
const PAGES: Array<{ testId: string; url: string; pageTestId: string }> = [
  { testId: 'rail-manage', url: '/manage', pageTestId: 'manage-page' },
  { testId: 'rail-admin', url: '/admin', pageTestId: 'admin-page' },
  { testId: 'rail-automations', url: '/automations', pageTestId: 'automations-page' },
];

for (const p of PAGES) {
  test(`clicking a request from ${p.url} navigates back to the request editor`, async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('boss1785867669@test.io');
    await page.getByTestId('login-password').fill('bosspass123');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();

    await page.getByTestId('workspace-My Workspace').click();
    const req = page.getByTestId('sidebar-request-GET all posts');
    await expect(req).toBeVisible();

    await page.getByTestId(p.testId).click();
    await expect(page).toHaveURL(new RegExp(p.url));
    await expect(page.getByTestId(p.pageTestId)).toBeVisible();
    await expect(req).toBeVisible();

    await req.click();

    await page.waitForTimeout(1500);
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('url-input')).toBeVisible();
  });
}
