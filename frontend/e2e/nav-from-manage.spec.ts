import { test, expect } from '@playwright/test';

/**
 * Top-level pages (/manage, /admin, /automations) hide the workspace sidebar
 * panel (workspace chips + collections tree). Clicking the rail "APIs" button
 * must navigate back to the workspace and restore the panel + request editor.
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
  test(`sidebar panel is hidden on ${p.url} and rail-apis returns to the editor`, async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('boss1785867669@test.io');
    await page.getByTestId('login-password').fill('bosspass123');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();

    await page.getByTestId('workspace-My Workspace').click();
    const req = page.getByTestId('sidebar-request-GET all posts');
    await expect(req).toBeVisible();
    await req.click();
    await expect(page.getByTestId('url-input')).toBeVisible();

    await page.getByTestId(p.testId).click();
    await expect(page).toHaveURL(new RegExp(p.url));
    await expect(page.getByTestId(p.pageTestId)).toBeVisible();

    // Workspace panel (workspace chips + collections tree) must be hidden.
    await expect(page.getByTestId('workspace-My Workspace')).not.toBeVisible();
    await expect(req).not.toBeVisible();
    // The icon rail stays so the user can navigate back.
    await expect(page.getByTestId('rail-apis')).toBeVisible();

    await page.getByTestId('rail-apis').click();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('workspace-My Workspace')).toBeVisible();
    await expect(page.getByTestId('url-input')).toBeVisible();
  });
}
