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
});
