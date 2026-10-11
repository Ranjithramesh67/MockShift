import { test, expect } from '@playwright/test';

test('sidebar boots workspace-first: workspaces above collections, no project node', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();

  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toBeVisible({ timeout: 20000 });

  // The project is chosen from the top bar and never rendered inside the tree.
  await expect(page.getByTestId('project-switcher-button')).toBeVisible();
  await expect(sidebar.locator('.tree-project')).toHaveCount(0);
  await expect(sidebar.locator('.tree-workspace')).toHaveCount(0);

  // Workspaces sit above Collections.
  const workspacesHeading = sidebar.getByRole('heading', { name: 'Workspaces' });
  const collectionsHeading = sidebar.getByRole('heading', { name: 'Collections' });
  await expect(workspacesHeading).toBeVisible();
  await expect(collectionsHeading).toBeVisible();
  const workspacesBox = await workspacesHeading.boundingBox();
  const collectionsBox = await collectionsHeading.boundingBox();
  expect(workspacesBox!.y).toBeLessThan(collectionsBox!.y);

  // The chips list the active project's workspaces.
  await expect(page.getByTestId('workspace-chips')).toBeVisible();
  await expect(page.locator('.workspace-chip').first()).toBeVisible();
});
