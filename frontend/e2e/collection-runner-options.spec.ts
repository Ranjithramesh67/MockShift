import { test, expect } from '@playwright/test';

/**
 * Collection Runner QA options:
 *  - the Run options fieldset (stop-on-error / delay / retries / iterations)
 *    and the dataset box are shown before running
 *  - "Run again" honours the selected iterations (total = requests x iterations)
 *  - every report export button is available once a result exists
 *
 * Depends on the seed data created by `cd backend && npm run seed:dev`
 * (ADMIN account, "My Workspace", "Mock API Demo" collection on :3999) and a
 * running frontend/backend, exactly like `assertions-runner.spec.ts`.
 */
test('collection runner applies iterations and exposes report exports', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.getByTestId('workspace-My Workspace').click();
  await page.getByTestId('collection-Mock API Demo').hover();
  await page.getByTestId('collection-options-Mock API Demo').click();
  await page.getByTestId('run-collection-Mock API Demo').click();

  const modal = page.getByTestId('collection-runner-modal');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('runner-options')).toBeVisible();
  await expect(page.getByTestId('runner-data')).toBeVisible();

  const summary = page.getByTestId('collection-run-summary');
  await expect(summary).toBeVisible();
  const initialText = (await summary.textContent()) || '';
  const initialTotal = Number(/Requests:\s*(\d+)/.exec(initialText)?.[1]);
  expect(initialTotal).toBeGreaterThan(0);

  // A CSV dataset shows a live row/column summary before running.
  await page.getByTestId('runner-data').fill('email\na@b.io\nc@d.io\n');
  await expect(page.getByTestId('runner-data-summary')).toContainText('2 rows');
  // Clear it so the iteration count drives the plan.
  await page.getByTestId('runner-data').fill('');

  // Double the iterations and run again; the plan size doubles with it.
  await page.getByTestId('runner-iterations').fill('2');
  await page.getByTestId('runner-run').click();
  await expect(summary).toContainText(`Requests: ${initialTotal * 2}`);

  // Report exports are offered for the finished run.
  await expect(page.getByTestId('runner-exports')).toBeVisible();
  await expect(page.getByTestId('runner-export-json')).toBeVisible();
  await expect(page.getByTestId('runner-export-junit')).toBeVisible();
  await expect(page.getByTestId('runner-export-csv')).toBeVisible();
  await expect(page.getByTestId('runner-export-markdown')).toBeVisible();
  await expect(page.getByTestId('runner-export-html')).toBeVisible();

  await page.getByTestId('collection-runner-done').click();
});
