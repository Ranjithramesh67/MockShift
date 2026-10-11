'use strict';

// UI flows shared by the functional and browser-run suites.

async function firstCollectionId(page, config) {
  await page.goto(`${config.MAIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid^="new-request-"]', { timeout: 30000 });
  return page.$eval('[data-testid^="new-request-"]', (el) =>
    el.getAttribute('data-testid').replace(/^new-request-/, '')
  );
}

// Create a request in the first collection and open it in the editor.
async function createRequest(page, config, { name, url }) {
  const coll = await firstCollectionId(page, config);
  await page.click(`[data-testid="new-request-${coll}"]`);
  await page.waitForSelector('[data-testid="new-api-modal"]', { timeout: 15000 });
  await page.fill('[data-testid="create-name"]', name);
  const urlEl = await page.$('[data-testid="create-url"]');
  if (urlEl) await urlEl.fill(url);
  await page.click('[data-testid="create-submit"]');
  await page.waitForSelector(`[data-testid="sidebar-request-${name}"]`, { timeout: 15000 });
  await page.click(`[data-testid="sidebar-request-${name}"]`);
  await page.waitForSelector('[data-testid="send-button"]', { timeout: 15000 });
}

async function sendAndWait(page, timeout = 45000) {
  await page.click('[data-testid="send-button"]');
  await page
    .waitForFunction(() => !document.querySelector('[data-testid="response-loading"]'), { timeout })
    .catch(() => {});
  await page.waitForTimeout(600);
}

const statusChip = (page) =>
  page.$eval('.response-pane .status-chip', (el) => el.textContent.trim()).catch(() => null);
const runError = (page) =>
  page.$eval('[data-testid="run-error"]', (el) => el.textContent.trim()).catch(() => null);
const paneText = (page) =>
  page.$eval('[data-testid="response-pane"]', (el) => el.innerText.replace(/\s+/g, ' ')).catch(() => '');

async function setLocalToggle(page, on) {
  const el = await page.$('[data-testid="run-in-browser-toggle"]');
  if (!el) return false;
  const pressed = await page.$eval('[data-testid="run-in-browser-toggle"]', (e) => e.getAttribute('aria-pressed'));
  if ((pressed === 'true') !== on) await page.click('[data-testid="run-in-browser-toggle"]');
  return true;
}

module.exports = { firstCollectionId, createRequest, sendAndWait, statusChip, runError, paneText, setLocalToggle };
