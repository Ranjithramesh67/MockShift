'use strict';

const { newPage, login } = require('../lib/browser.cjs');
const ui = require('../lib/ui.cjs');

module.exports = {
  name: 'functional',
  async run({ config, browser, report }) {
    if (!config.BOSS.pass) {
      report.warn('functional', 'boss password not set');
      return;
    }
    const page = await newPage(browser);
    // eslint-disable-next-line no-undef
    const ts = Date.now().toString().slice(-6);
    const name = `ZZe2e_fn_${ts}`;
    let createdId = null;
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    page.on('response', async (res) => {
      try {
        if (/\/api\/requests$/.test(res.url()) && res.request().method() === 'POST') {
          const json = await res.json();
          createdId = json.request ? json.request.id : json.id;
        }
      } catch {
        /* non-json */
      }
    });

    try {
      await login(page, config.MAIN, config.BOSS);

      // Create + run (server path).
      await ui.createRequest(page, config, { name, url: `${config.MAIN}/api/health` });
      await ui.setLocalToggle(page, false);
      await ui.sendAndWait(page);
      const chip = await ui.statusChip(page);
      const pane = await ui.paneText(page);
      if (chip === '200' && /mockshift-api/.test(pane)) report.pass('functional.create-and-run', '200');
      else report.fail('functional.create-and-run', `chip=${chip}`);

      // Run recorded in history.
      const hist = await page.evaluate(async () => {
        const r = await fetch('/api/history?limit=25');
        return r.ok ? r.json() : null;
      });
      const runs = hist ? hist.runs || hist : [];
      if (createdId && runs.some((x) => x.request_id === createdId || x.requestId === createdId)) {
        report.pass('functional.run-in-history', createdId);
      } else {
        const foundByName = runs.some((x) => (x.request_name || x.name) === name);
        report[foundByName ? 'pass' : 'fail']('functional.run-in-history', `id=${createdId} byName=${foundByName}`);
      }

      // Share link renders (regression BLK-1).
      if (createdId) {
        const share = await page.evaluate(async (id) => {
          const r = await fetch('/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemType: 'request', itemId: id }),
          });
          return { status: r.status, body: await r.json().catch(() => null) };
        }, createdId);
        const token = share.body && share.body.share && share.body.share.token;
        if (share.status === 201 && token) report.pass('functional.share-create', '201');
        else report.fail('functional.share-create', `${share.status}`);
        if (token) {
          const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
          const sp = await ctx.newPage();
          const sErr = [];
          sp.on('pageerror', (e) => sErr.push(String(e.message).slice(0, 160)));
          await sp.goto(`${config.MAIN}/s/${token}`, { waitUntil: 'networkidle' });
          await sp.waitForTimeout(1000);
          const cards = await sp
            .locator('.share-card, [data-testid="share-card"], [data-testid="share-login-required"]')
            .count();
          if (cards > 0 && sErr.length === 0) report.pass('functional.share-page', 'renders');
          else report.fail('functional.share-page', `cards=${cards} errors=${sErr.join('|')}`);
          await ctx.close();
        }
      } else {
        report.warn('functional.share-create', 'request id not captured');
      }

      // Scratchpad: run without saving.
      try {
        await page.goto(`${config.MAIN}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="topbar-test-curl"]', { timeout: 20000 });
        await page.click('[data-testid="topbar-test-curl"]');
        await page.waitForSelector('[data-testid="scratchpad-workspace"]', { timeout: 15000 });
        await page.fill('[data-testid="scratchpad-url"]', `${config.MAIN}/api/health`);
        await page.click('[data-testid="scratchpad-send"]');
        await page
          .waitForFunction(() => !document.querySelector('[data-testid="response-loading"]'), { timeout: 30000 })
          .catch(() => {});
        await page.waitForTimeout(800);
        const sc = await ui.statusChip(page);
        report[sc === '200' ? 'pass' : 'fail']('functional.scratchpad', `chip=${sc}`);
      } catch (e) {
        report.fail('functional.scratchpad', e.message.slice(0, 140));
      }

      report[pageErrors.length ? 'fail' : 'pass']('functional.no-page-errors', pageErrors.join(' | '));
    } catch (e) {
      report.fail('functional.setup', e.message.slice(0, 160));
    } finally {
      await page._ctx.close();
    }
  },
};
