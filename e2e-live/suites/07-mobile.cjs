'use strict';

const { newPage, login } = require('../lib/browser.cjs');

module.exports = {
  name: 'mobile',
  async run({ config, browser, report }) {
    if (!config.BOSS.pass) {
      report.warn('mobile', 'boss password not set');
      return;
    }
    const page = await newPage(browser, { width: 390, height: 844, isMobile: true, hasTouch: true });
    try {
      await login(page, config.MAIN, config.BOSS);
      await page.goto(`${config.MAIN}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const o = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      const overflow = o.sw - o.cw;
      report[overflow <= 2 ? 'pass' : 'fail']('mobile.no-horizontal-overflow', `overflow ${overflow}px`);
    } catch (e) {
      report.fail('mobile', e.message.slice(0, 140));
    } finally {
      await page._ctx.close();
    }
  },
};
