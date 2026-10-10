'use strict';

// Playwright helpers shared by every suite: launch a Chromium, open contexts,
// and log in through the real UI (with a hydration-safe retry).

function chromiumFor(config) {
  // eslint-disable-next-line import/no-dynamic-require
  return require(config.PW).chromium;
}

async function launch(config, { bypassLna = false, headless } = {}) {
  const { chromium } = require(config.PW);
  const args = ['--no-sandbox'];
  if (bypassLna) args.push(`--disable-features=${config.LNA_BYPASS_FEATURES}`);
  return chromium.launch({
    executablePath: config.CHROMIUM,
    headless: headless === undefined ? !config.HEADED : headless,
    args,
  });
}

async function newPage(browser, { width = 1440, height = 900, isMobile = false, hasTouch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile, hasTouch });
  const page = await ctx.newPage();
  page._ctx = ctx;
  return page;
}

async function login(page, base, cred) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="login-email"]', { timeout: 20000 });
    // Wait for React to hydrate so the submit handler is attached.
    await page
      .waitForSelector('[data-testid="login-submit"]:not([disabled])', { timeout: 20000 })
      .catch(() => {});
    await page.fill('[data-testid="login-email"]', cred.email);
    await page.fill('[data-testid="login-password"]', cred.pass);
    try {
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
        page.click('[data-testid="login-submit"]'),
      ]);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await page.waitForTimeout(800);
    }
  }
}

module.exports = { chromiumFor, launch, newPage, login };
