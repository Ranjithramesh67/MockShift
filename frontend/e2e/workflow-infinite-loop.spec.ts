import { test, expect, Page } from '@playwright/test';

/**
 * Verifies the workflow builder refuses to save a workflow whose loop can
 * never terminate, and only persists valid workflows.
 */

async function openWorkflowBuilder(page: Page) {
  await page.goto('/');
  await page.getByTestId('main-tab-workflow').click();
  await expect(page.getByTestId('workflow-builder')).toBeVisible();
}

test('blocks saving a workflow with an until-loop that has no exit condition', async ({ page }) => {
  await openWorkflowBuilder(page);
  await expect(page.getByTestId('workflow-name-input')).toHaveValue('Order fulfilment');

  // Step 1 (index 0) defaults to "No loop".
  await expect(page.getByTestId('step-loop-type-0')).toHaveValue('none');

  // Configure an "until condition" loop but leave the condition empty.
  await page.getByTestId('step-loop-type-0').selectOption('until');

  await page.getByTestId('workflow-save-button').click();

  // Save is blocked with a visible, specific error.
  const banner = page.getByTestId('workflow-errors');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('loop would run forever');
  await expect(page.getByTestId('toast')).toContainText('Workflow not saved');

  // The invalid config must NOT have been persisted.
  await page.reload();
  await page.getByTestId('main-tab-workflow').click();
  await expect(page.getByTestId('step-loop-type-0')).toHaveValue('none');
});

test('blocks saving a workflow with a non-positive loop count', async ({ page }) => {
  await openWorkflowBuilder(page);

  await page.getByTestId('step-loop-type-0').selectOption('count');
  await page.getByTestId('step-loop-count-0').fill('0');
  await page.getByTestId('workflow-save-button').click();

  await expect(page.getByTestId('workflow-errors')).toContainText('non-terminating');

  // Correcting the count to a valid positive number allows the save.
  await page.getByTestId('step-loop-count-0').fill('3');
  await page.getByTestId('workflow-save-button').click();
  await expect(page.getByTestId('workflow-errors')).not.toBeVisible();
  await expect(page.getByTestId('toast')).toContainText('Workflow saved');

  // Persisted value survives a reload.
  await page.reload();
  await page.getByTestId('main-tab-workflow').click();
  await expect(page.getByTestId('step-loop-type-0')).toHaveValue('count');
  await expect(page.getByTestId('step-loop-count-0')).toHaveValue('3');
});

test('blocks saving an until-loop whose condition references its own step', async ({ page }) => {
  await openWorkflowBuilder(page);

  await page.getByTestId('step-loop-type-0').selectOption('until');
  const condition = page.getByLabel('Loop condition for step 1');
  await condition.click();
  await page.keyboard.insertText('$steps.create_order.status === "SUCCESS"');
  await page.getByTestId('workflow-save-button').click();

  await expect(page.getByTestId('workflow-errors')).toContainText('own result');
  await expect(page.getByTestId('workflow-errors')).toContainText('loop would run forever');
});
