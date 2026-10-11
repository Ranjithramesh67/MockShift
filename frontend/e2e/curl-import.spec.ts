import { test, expect, Page } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * Verifies that the "Import cURL" entry point opens the same model as
 * "New API request" (its cURL tab), and that pasting a complex cURL command
 * populates the request editor: method, URL, query params, headers (including
 * values containing colons) and a JSON body with escaped quotes.
 */

const COMPLEX_CURL = [
  'curl --silent --compressed --location \\',
  "  -X POST 'https://api.example.com/v2/orders?expand=items&page=1' \\",
  "  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token:with:colons' \\",
  "  -H 'Content-Type: application/json' \\",
  "  -H 'Accept: application/json' \\",
  "  -H 'X-Trace-Id: 7f3c-9a2b' \\",
  "  -H 'Cookie: session=abc123; theme=dark' \\",
  "  --data-raw '{\"customer\":{\"id\":\"cus_123\"},\"items\":[{\"sku\":\"A1\",\"qty\":2}],\"note\":\"say \\\"hi\\\"\"}'",
].join('\n');

async function rowValues(page: Page, rowTestId: string): Promise<{ key: string; value: string }> {
  const row = page.getByTestId(rowTestId);
  return {
    key: await row.locator('input[aria-label="Key"]').inputValue(),
    value: await row.locator('input[aria-label="Value"]').inputValue(),
  };
}

test('pasting a complex cURL command populates method, URL, headers and body', async ({ page }) => {
  await signupFreshUser(page);
  await page.goto('/');

  // Signup creates a private workspace ("My Workspace") with no collections.
  // Select it, then create a collection to import the request into.
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('new-collection').click();
  await expect(page.getByTestId('new-collection-modal')).toBeVisible();
  await page.getByTestId('create-name').fill('Imports');
  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('new-collection-modal')).not.toBeVisible();

  await page.getByTestId('topbar-import-curl').click();

  // Import cURL reuses the New API request modal, opened on its cURL tab.
  await expect(page.getByTestId('new-api-modal')).toBeVisible();
  await expect(page.getByTestId('create-mode-curl')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('create-curl-input').fill(COMPLEX_CURL);
  await page.getByTestId('create-submit').click();

  // The modal closes and the imported request opens in the editor.
  await expect(page.getByTestId('new-api-modal')).not.toBeVisible();

  // --- Method and URL -------------------------------------------------------
  await expect(page.getByTestId('method-select')).toHaveValue('POST');
  await expect(page.getByTestId('url-input')).toHaveValue('https://api.example.com/v2/orders');

  // --- Query params ---------------------------------------------------------
  await page.getByTestId('request-tab-params').click();
  const params = await rowValues(page, 'params-row-0');
  expect(params).toEqual({ key: 'expand', value: 'items' });
  const params2 = await rowValues(page, 'params-row-1');
  expect(params2).toEqual({ key: 'page', value: '1' });

  // --- Headers (including a value with colons and a cookie) -----------------
  await page.getByTestId('request-tab-headers').click();
  const authorization = await rowValues(page, 'headers-row-0');
  expect(authorization).toEqual({
    key: 'Authorization',
    value: 'Bearer eyJhbGciOiJIUzI1NiJ9.token:with:colons',
  });

  const headerKeys = await page
    .getByTestId(/headers-row-\d+/)
    .locator('input[aria-label="Key"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(headerKeys).toEqual(['Authorization', 'Content-Type', 'Accept', 'X-Trace-Id', 'Cookie']);

  const cookie = await rowValues(page, 'headers-row-4');
  expect(cookie).toEqual({ key: 'Cookie', value: 'session=abc123; theme=dark' });

  // --- JSON body with escaped quotes ----------------------------------------
  await page.getByTestId('request-tab-body').click();
  const bodyContent = await page
    .getByTestId('editor-json')
    .locator('.cm-content')
    .textContent();
  expect(bodyContent).toContain('"customer"');
  expect(bodyContent).toContain('"cus_123"');
  expect(bodyContent).toContain('"say \\"hi\\""');

  // The JSON body is parseable and intact.
  const parsed = JSON.parse(bodyContent!);
  expect(parsed.customer.id).toBe('cus_123');
  expect(parsed.items[0].sku).toBe('A1');
  expect(parsed.note).toBe('say "hi"');
});
