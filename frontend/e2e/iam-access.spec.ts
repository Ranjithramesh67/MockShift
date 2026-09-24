import { test, expect } from '@playwright/test';

test('IAM access screen: rail, members, roles, create role', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await expect(page.getByTestId('rail-access')).toBeVisible();

  await page.goto('/access');
  await expect(page.getByTestId('iam-view')).toBeVisible();
  await expect(page.getByTestId('iam-org-select')).toBeVisible();

  await expect(page.getByTestId('iam-member-row').first()).toBeVisible();
  await page
    .locator('[data-testid="iam-member-row"]')
    .first()
    .getByRole('button', { name: 'Manage roles' })
    .click();
  await expect(page.getByTestId('iam-member-roles-modal')).toBeVisible();
  await page.getByTestId('iam-member-roles-cancel').click();
  await expect(page.getByTestId('iam-member-roles-modal')).toBeHidden();

  await page.getByTestId('iam-tab-roles').click();
  await expect(page.getByTestId('iam-role-row').first()).toBeVisible();
  await expect(page.getByText('System').first()).toBeVisible();

  await page.getByTestId('iam-create-role').click();
  await expect(page.getByTestId('iam-role-modal')).toBeVisible();
  await expect(page.getByTestId('iam-role-save')).toBeDisabled();
  await page.getByTestId('iam-role-name').fill('E2E Temp Role');
  await page.getByTestId('iam-permission-project.view').check();
  await expect(page.getByTestId('iam-role-save')).toBeEnabled();
  await page.getByTestId('iam-role-save').click();
  await expect(page.getByTestId('iam-role-modal')).toBeHidden();

  const created = page.getByTestId('iam-role-row').filter({ hasText: 'E2E Temp Role' });
  await expect(created).toBeVisible();

  page.on('dialog', (d) => d.accept());
  await created.getByRole('button', { name: 'Delete' }).click();
  await expect(created).toHaveCount(0);
});
