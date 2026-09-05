import { test, expect, Page } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * New API request modal — Form | cURL.
 * Form mode shows Name/Type/Method/URL plus method-driven horizontal tabs
 * (Params/Headers always; Body only for POST/PUT/PATCH). cURL mode parses a
 * pasted curl command and pre-fills the saved request.
 */

async function openInCollection(page: Page): Promise<void> {
  await signupFreshUser(page);
  await page.goto('/');
  await page.getByTestId('workspace-My Workspace').click();
  await page.getByTestId('new-collection').click();
  await expect(page.getByTestId('new-collection-modal')).toBeVisible();
  await page.getByTestId('create-name').fill('FormBox');
  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('new-collection-modal')).not.toBeVisible();
  await page.getByTestId('new-request-FormBox').click();
  await expect(page.getByTestId('new-api-modal')).toBeVisible();
}

test('form mode: GET shows Params/Headers tabs, POST adds a Body tab and persists it', async ({ page }) => {
  await openInCollection(page);

  // Form mode is the default with Params/Headers tabs but no Body tab for GET.
  await expect(page.getByTestId('create-mode-form')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('create-method')).toHaveValue('GET');
  await expect(page.getByTestId('create-tab-params')).toBeVisible();
  await expect(page.getByTestId('create-tab-headers')).toBeVisible();
  await expect(page.getByTestId('create-tab-body')).toHaveCount(0);

  // Switching to POST surfaces the Body tab.
  await page.getByTestId('create-method').selectOption('POST');
  await expect(page.getByTestId('create-tab-body')).toBeVisible();

  await page.getByTestId('create-url').fill('https://api.example.com/v2/orders');

  // A GET request collects query params instead of a body.
  await page.getByTestId('create-method').selectOption('GET');
  await expect(page.getByTestId('create-tab-body')).toHaveCount(0);
  await page.getByTestId('create-params-add').click();
  await page.getByTestId('create-params-row-0').locator('input[aria-label="Key"]').fill('page');
  await page.getByTestId('create-params-row-0').locator('input[aria-label="Value"]').fill('1');

  // Back to POST and type a JSON body.
  await page.getByTestId('create-method').selectOption('POST');
  await page.getByTestId('create-tab-body').click();
  await expect(page.getByTestId('create-body-editor')).toBeVisible();
  await page.getByTestId('create-body-input').fill('{"customer":"A1","qty":2}');

  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('new-api-modal')).not.toBeVisible();

  // The created request keeps method, URL, params and body.
  await expect(page.getByTestId('method-select')).toHaveValue('POST');
  await expect(page.getByTestId('url-input')).toHaveValue('https://api.example.com/v2/orders');

  await page.getByTestId('request-tab-body').click();
  await expect(page.getByTestId('editor-json')).toBeVisible();
  await expect(page.getByTestId('editor-json').locator('.cm-content')).toContainText('"customer"');
});

test('curl mode: pasting a curl command pre-fills the created request', async ({ page }) => {
  await openInCollection(page);

  await page.getByTestId('create-mode-curl').click();
  await expect(page.getByTestId('create-mode-curl')).toHaveAttribute('aria-pressed', 'true');

  const curl = [
    'curl -X POST \'https://api.example.com/orders?expand=items\' \\',
    "  -H 'Authorization: Bearer token123' \\",
    "  -H 'Content-Type: application/json' \\",
    "  --data-raw '{\"sku\":\"A1\",\"qty\":2}'",
  ].join('\n');
  await page.getByTestId('create-curl-input').fill(curl);
  await expect(page.getByTestId('create-curl-preview')).toContainText('POST');

  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('new-api-modal')).not.toBeVisible();

  await expect(page.getByTestId('method-select')).toHaveValue('POST');
  await expect(page.getByTestId('url-input')).toHaveValue('https://api.example.com/orders');

  await page.getByTestId('request-tab-params').click();
  await expect(page.getByTestId('params-row-0').locator('input[aria-label="Key"]')).toHaveValue('expand');
});
