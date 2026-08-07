import { test, expect } from '@playwright/test';

/**
 * Environments UI (backlog item #2):
 *  - the sidebar "Env" button opens the environments modal
 *  - you can create an environment, activate it, and add plain + secret vars
 *  - the active environment is used at run time: a request URL with {{BASE_URL}}
 *    resolves against the active environment and runs successfully.
 *
 * Depends on seed data (ADMIN "My Workspace", "Mock API Demo" on :3999).
 */
test('create an environment, set variables, and run a request with {{var}}', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Idempotent runs: drop any "E2E Staging" environment left behind by a
  // previous run so the create + strict-mode `env-E2E Staging` assertion below
  // cannot resolve to multiple rows.
  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const envs = (await (await page.request.get(`/api/workspaces/${myWs.id}/environments`)).json())
    .environments as Array<{ id: string; name: string }>;
  for (const env of envs.filter((e) => e.name === 'E2E Staging')) {
    await page.request.delete(`/api/environments/${env.id}`);
  }

  // Select the seeded workspace so the environments modal knows its role.
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('request-configurator')).toBeVisible();

  // Open the environments modal.
  await page.getByTestId('environments-open').click();
  await expect(page.getByTestId('environments-modal')).toBeVisible();

  // Create an environment and activate it.
  await page.getByTestId('new-env-name').fill('E2E Staging');
  await page.getByTestId('new-env-create').click();
  await expect(page.getByTestId('env-E2E Staging')).toBeVisible();

  // Activate it (first env auto-activates, but be explicit for robustness).
  const activateBtn = page.getByTestId('activate-E2E Staging');
  if (await activateBtn.count()) await activateBtn.click();

  // Add variables: BASE_URL (plain) + API_TOKEN (secret).
  await page.getByTestId('add-variable').click();
  await page.getByTestId('var-key').fill('BASE_URL');
  await page.getByTestId('var-value').fill('http://127.0.0.1:3999');
  await page.getByTestId('add-variable').click();
  const rows = page.locator('.env-vars-table tbody tr');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).locator('[data-testid="var-key"]').fill('API_TOKEN');
  await rows.nth(1).locator('[data-testid="var-value"]').fill('e2e-secret-token');
  await rows.nth(1).locator('[data-testid="var-secret"]').check();
  await page.getByTestId('save-variables').click();
  await expect(page.getByTestId('save-variables')).toBeVisible();

  // Close the modal.
  await page.getByTestId('modal-close').click();
  await expect(page.getByTestId('environments-modal')).not.toBeVisible();

  // Re-open and confirm the secret is masked (password input) but the plain
  // variable round-trips.
  await page.getByTestId('environments-open').click();
  await expect(page.getByTestId('env-E2E Staging')).toBeVisible();
  const valueInputs = page.locator('.env-vars-table tbody tr [data-testid="var-value"]');
  await expect(valueInputs).toHaveCount(2);
  const baseUrlRow = page.locator('.env-vars-table tbody tr', {
    has: page.locator('input[data-testid="var-key"][value="BASE_URL"]'),
  });
  const tokenRow = page.locator('.env-vars-table tbody tr', {
    has: page.locator('input[data-testid="var-key"][value="API_TOKEN"]'),
  });
  await expect(baseUrlRow.locator('[data-testid="var-value"]')).toHaveValue('http://127.0.0.1:3999');
  await expect(tokenRow.locator('[data-testid="var-value"]')).toHaveAttribute('type', 'password');
  await page.getByTestId('modal-close').click();

  // Select the seeded "GET all posts" request and point it at {{BASE_URL}}.
  await page.getByTestId('sidebar-request-GET all posts').click();
  await expect(page.getByTestId('url-input')).toBeVisible();
  await page.getByTestId('url-input').fill('{{BASE_URL}}/posts');
  await page.getByTestId('save-request-button').click();

  // Send: the active environment must resolve BASE_URL to the mock upstream.
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-pane')).toBeVisible();
  await expect(page.getByTestId('response-pane')).toContainText('Status: 200');
});
