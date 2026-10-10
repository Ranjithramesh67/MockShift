'use strict';

const { newPage, login } = require('../lib/browser.cjs');

module.exports = {
  name: 'admin',
  async run({ config, browser, report }) {
    if (!config.SUPER.pass) {
      report.warn('admin', 'superadmin password not set');
      return;
    }
    const page = await newPage(browser);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    try {
      await login(page, config.MAIN, config.SUPER);
      for (const route of ['/admin', '/superadmin']) {
        const resp = await page.goto(config.MAIN + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1200);
        const ok = resp && resp.status() < 400;
        report[ok ? 'pass' : 'fail'](`admin${route}`, `status ${resp && resp.status()}`);
      }
      report[pageErrors.length ? 'fail' : 'pass']('admin.no-page-errors', pageErrors.join(' | '));
    } catch (e) {
      report.fail('admin.login', e.message.slice(0, 140));
    } finally {
      await page._ctx.close();
    }
  },
};
