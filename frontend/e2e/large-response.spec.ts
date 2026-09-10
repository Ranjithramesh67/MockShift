import { test, expect } from '@playwright/test';

/**
 * Regression: a very large API response must scroll inside the response pane,
 * not grow the pane/page. The response CodeMirror wrapper is constrained to
 * the pane height and its scroller overflows internally.
 */
test('large response scrolls inside the response pane', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.getByTestId('workspace-My Workspace').click();
  await page.getByTestId('sidebar-request-GET all posts').click();
  await expect(page.getByTestId('url-input')).toBeVisible();

  // Point the request at the mock /echo and POST a large JSON body so the
  // response is big enough to overflow the pane.
  const big = 'A'.repeat(200000);
  await page.getByTestId('url-input').fill('http://127.0.0.1:3999/echo');
  await page.getByTestId('method-select').selectOption('POST');
  await page.getByTestId('request-tab-body').click();
  await page.getByTestId('body-type-select').selectOption('JSON');
  const bodyEditor = page.getByTestId('body-editor').locator('.cm-content');
  await bodyEditor.click();
  await bodyEditor.fill(`{"data":"${big}"}`);
  await page.getByTestId('send-button').click();

  const pane = page.getByTestId('response-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toContainText('Size:');

  // Give the run/response a moment, then check the editor is bounded.
  await page.waitForTimeout(1200);

  const metrics = await page.locator('.response-body .code-editor').evaluate((el) => {
    const scroller = el.querySelector('.cm-scroller');
    const scrollBefore = scroller ? scroller.scrollTop : 0;
    if (scroller) scroller.scrollTop = 500;
    return {
      editorClientHeight: el.clientHeight,
      editorScrollHeight: el.scrollHeight,
      paneClientHeight: el.closest('.response-pane')?.clientHeight ?? 0,
      scrollerClientHeight: scroller ? scroller.clientHeight : 0,
      scrollerScrollHeight: scroller ? scroller.scrollHeight : 0,
      scrollerOverflowY: scroller ? getComputedStyle(scroller).overflowY : '',
      scrollerScrolled: scroller ? scroller.scrollTop > scrollBefore : false,
    };
  });
  console.log('metrics:', JSON.stringify(metrics));

  // Editor must fit within the pane (not grow the page).
  expect(metrics.editorClientHeight).toBeGreaterThan(0);
  expect(metrics.editorClientHeight).toBeLessThanOrEqual(metrics.paneClientHeight + 1);
  // The internal scroller scrolls vertically.
  expect(['auto', 'scroll']).toContain(metrics.scrollerOverflowY);
  // The scroller must be the constrained, overflowable element: its own box is
  // bounded and shorter than its content, and it actually scrolls. This catches
  // the regression where the CodeMirror wrapper grows to the content height so
  // the scroller never overflows (and the editor is clipped by overflow:hidden).
  expect(metrics.scrollerClientHeight).toBeLessThanOrEqual(metrics.editorClientHeight + 1);
  expect(metrics.scrollerScrollHeight).toBeGreaterThan(metrics.scrollerClientHeight);
  expect(metrics.scrollerScrolled).toBe(true);

  // The page itself must not grow.
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewport = await page.evaluate(() => window.innerHeight);
  expect(pageHeight).toBeLessThanOrEqual(viewport + 1);
});
