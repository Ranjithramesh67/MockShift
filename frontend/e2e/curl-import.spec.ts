import { test, expect, Page } from '@playwright/test';

/**
 * Verifies that pasting a complex cURL command populates the request editor:
 * method, URL, query params, headers (including values containing colons) and
 * a JSON body with escaped quotes.
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
  await page.goto('/');

  await page.getByTestId('import-curl-button').click();
  await expect(page.getByTestId('curl-modal')).toBeVisible();
  await page.getByTestId('curl-paste-input').fill(COMPLEX_CURL);
  await page.getByTestId('curl-import-confirm').click();

  // The modal closes and a success toast confirms the import.
  await expect(page.getByTestId('curl-modal')).not.toBeVisible();
  await expect(page.getByTestId('toast')).toContainText('cURL imported');

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
