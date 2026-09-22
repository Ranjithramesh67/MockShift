import { test, expect } from '@playwright/test';

test('sidebar boots project-first: project header contains its workspaces', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20000 });

  const project = page.locator('.tree-project').first();
  await expect(project).toBeVisible({ timeout: 20000 });
  await expect(project.locator('.tree-project-name')).toBeVisible();
  await expect(project.locator('[data-testid="workspace-node"]').first()).toBeVisible();

  // The project tree is primary: it must sit above the secondary Workspaces
  // picker, so the project never reads as nested under a workspace.
  const workspaces = page.locator('.sidebar-section-secondary');
  await expect(workspaces).toBeVisible();
  const projectBox = await project.boundingBox();
  const workspacesBox = await workspaces.boundingBox();
  expect(projectBox!.y).toBeLessThan(workspacesBox!.y);
});
