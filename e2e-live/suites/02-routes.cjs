'use strict';

const { newPage, login } = require('../lib/browser.cjs');

const MAIN_ROUTES = [
  '/', '/inbox', '/history', '/collab', '/docs', '/contracts', '/copilot',
  '/mock-scenarios', '/monitors', '/automations', '/network', '/access',
  '/manage', '/profile', '/json-compare', '/json-comparisons', '/org-analytics',
];
const PORTAL_ROUTES = ['/', '/login', '/account', '/checkout', '/gateway', '/manage', '/pay'];

async function crawl(page, base, routes, report, prefix) {
  const pageErrors = [];
  const five = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  page.on('response', (r) => {
    if (r.status() >= 500) five.push(`${r.status()} ${r.url().replace(base, '')}`);
  });
  for (const route of routes) {
    let status = null;
    let err = null;
    try {
      const resp = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = resp ? resp.status() : null;
      await page.waitForTimeout(1200);
    } catch (e) {
      err = e.message.slice(0, 120);
    }
    if (status && status < 400 && !err) report.pass(`${prefix}${route}`, `status ${status}`);
    else report.fail(`${prefix}${route}`, err || `status ${status}`);
  }
  return { pageErrors, five };
}

module.exports = {
  name: 'routes',
  async run({ config, browser, report }) {
    if (config.BOSS.pass) {
      const page = await newPage(browser);
      try {
        await login(page, config.MAIN, config.BOSS);
        const { pageErrors, five } = await crawl(page, config.MAIN, MAIN_ROUTES, report, 'routes.main');
        report[pageErrors.length ? 'fail' : 'pass']('routes.no-page-errors', pageErrors.join(' | '));
        report[five.length ? 'fail' : 'pass']('routes.no-5xx', five.join(' | '));
      } catch (e) {
        report.fail('routes.main.login', e.message.slice(0, 140));
      } finally {
        await page._ctx.close();
      }
    } else {
      report.warn('routes.main', 'boss password not set');
    }

    const portal = await newPage(browser);
    try {
      await crawl(portal, config.PORTAL, PORTAL_ROUTES, report, 'routes.portal');
    } finally {
      await portal._ctx.close();
    }
  },
  MAIN_ROUTES,
  PORTAL_ROUTES,
};
