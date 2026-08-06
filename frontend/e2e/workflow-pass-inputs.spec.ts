import { test, expect, Page } from '@playwright/test';
import { signupFreshUser } from './helpers';

/**
 * Verifies the workflow builder can pass a previous step's request/response
 * into the next request (passInputs), and that configured pass-throughs are
 * persisted with the workflow.
 */

async function openWorkflowBuilder(page: Page) {
  await signupFreshUser(page);
  await page.goto('/');
  await page.getByTestId('main-tab-workflow').click();
  await expect(page.getByTestId('workflow-builder')).toBeVisible();
}

test('passes the previous step response into the next request via the builder', async ({ page }) => {
  await openWorkflowBuilder(page);

  // The default workflow has two steps; step 2 (index 1) passes step 1's
  // response field `id` into a header named `x-order-id`.
  await page.getByTestId('pass-field-1').fill('id');
  await page.getByTestId('pass-key-1').fill('x-order-id');
  await page.getByTestId('pass-add-1').click();

  await expect(page.getByTestId('pass-item-1-0')).toContainText('Create the order');
  await expect(page.getByTestId('pass-item-1-0')).toContainText('x-order-id');

  await page.getByTestId('workflow-save-button').click();
  await expect(page.getByTestId('toast')).toContainText('Workflow saved');

  // Persisted pass-through survives a reload.
  await page.reload();
  await page.getByTestId('main-tab-workflow').click();
  await expect(page.getByTestId('pass-item-1-0')).toContainText('x-order-id');
});

test('removes a configured pass-through', async ({ page }) => {
  await openWorkflowBuilder(page);

  await page.getByTestId('pass-field-1').fill('id');
  await page.getByTestId('pass-key-1').fill('x-order-id');
  await page.getByTestId('pass-add-1').click();
  await expect(page.getByTestId('pass-item-1-0')).toBeVisible();

  await page.getByTestId('pass-remove-1-0').click();
  await expect(page.getByTestId('pass-item-1-0')).not.toBeVisible();
});

test('shows template references for earlier steps', async ({ page }) => {
  await openWorkflowBuilder(page);

  // Step 1 label "Create the order" -> template key `create_the_order`.
  await expect(page.getByText('{{step.create_the_order.response}}')).toBeVisible();
  await expect(page.getByText('{{stepRequest.create_the_order.url}}')).toBeVisible();
});
