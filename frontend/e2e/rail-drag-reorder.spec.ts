import { test, expect } from '@playwright/test';

/**
 * The sidebar icon rail can be reordered by dragging an icon onto another one.
 * The new order is persisted per user (PUT /api/profile/nav-order), so this
 * test resets it first and again in `finally` to leave the shared demo account
 * on the default order.
 */
test('rail icons reorder by drag', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.request.put('/api/profile/nav-order', { data: { order: [] } });
  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const docs = page.getByTestId('rail-docs');
  const workflow = page.getByTestId('rail-workflow');
  await expect(docs).toBeVisible();
  await expect(workflow).toBeVisible();

  try {
    const before = await docs.boundingBox();
    const wfBefore = await workflow.boundingBox();
    expect(before!.y).toBeGreaterThan(wfBefore!.y);

    await docs.dragTo(workflow);
    await page.waitForTimeout(800);

    const afterDocs = await docs.boundingBox();
    const afterWf = await workflow.boundingBox();
    expect(afterDocs!.y).toBeLessThan(afterWf!.y);
  } finally {
    await page.request.put('/api/profile/nav-order', { data: { order: [] } });
  }
});
