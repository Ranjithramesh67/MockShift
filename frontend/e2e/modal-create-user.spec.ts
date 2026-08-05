import { test, expect } from '@playwright/test';

/**
 * Regression: opening the "Create user" modal on /admin must overlay the page
 * (fixed, centered) instead of rendering as an unstyled block at the bottom of
 * the document, which expanded the page and collapsed the layout.
 */
test('create user modal overlays the page without expanding the layout', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.getByTestId('rail-admin').click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByTestId('admin-page')).toBeVisible();

  const viewportBefore = await page.evaluate(() => document.documentElement.scrollHeight);

  await page.getByTestId('create-user-open').click();
  const modal = page.getByTestId('create-user-modal');
  await expect(modal).toBeVisible();

  // The overlay must be fixed (covers the viewport, doesn't push content).
  const overlayPosition = await modal.evaluate((el) => getComputedStyle(el).position);
  expect(overlayPosition).toBe('fixed');

  // The modal card is centered and within the viewport.
  const box = await modal.locator('.modal').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width, vw: window.innerWidth, vh: window.innerHeight };
  });
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.vh);
  expect(box.width).toBeLessThanOrEqual(box.vw);

  // The form inputs are usable.
  await page.getByTestId('create-user-name').fill('Modal Tester');
  await expect(page.getByTestId('create-user-name')).toHaveValue('Modal Tester');

  // The document should not have grown because of the modal.
  const viewportAfter = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(viewportAfter).toBeLessThanOrEqual(viewportBefore + 1);

  await page.getByTestId('create-user-cancel').click();
  await expect(modal).not.toBeVisible();
});
