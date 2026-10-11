'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { launch, newPage, login } = require('../lib/browser.cjs');
const ui = require('../lib/ui.cjs');

// Chrome only gates "public site -> loopback" fetches. When E2E_MAIN itself is a
// loopback origin (local runs) the page is already local, so the gate never
// fires and there is no guidance to assert on.
function mainIsLoopback(main) {
  try {
    const host = new URL(main).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host) || host === '0.0.0.0';
  } catch {
    return false;
  }
}

function waitForPort(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - t0 > timeoutMs) reject(new Error('local echo service did not start'));
          else setTimeout(poll, 300);
        });
    })();
  });
}

async function runCase(config, { bypassLna, headless }) {
  const browser = await launch(config, { bypassLna, headless });
  try {
    const page = await newPage(browser);
    await login(page, config.MAIN, config.BOSS);
    const name = `ZZe2e_local_${Date.now().toString().slice(-6)}`;
    await ui.createRequest(page, config, { name, url: `${config.LOCAL_URL}/emea-router/api/health` });
    await ui.setLocalToggle(page, true);
    await ui.sendAndWait(page, 60000);
    return { chip: await ui.statusChip(page), err: await ui.runError(page), pane: await ui.paneText(page) };
  } finally {
    await browser.close();
  }
}

module.exports = {
  name: 'browser-run',
  async run({ config, report }) {
    if (!config.BOSS.pass) {
      report.warn('browser-run', 'boss password not set');
      return;
    }
    const script = path.resolve(__dirname, '..', 'scripts', 'local-echo.cjs');
    const srv = spawn(process.execPath, [script, String(config.LOCAL_PORT)], { stdio: 'ignore' });
    try {
      await waitForPort(`${config.LOCAL_URL}/probe`, 8000);

      // Pipeline works end-to-end when the LNA gate is not in the way.
      const ok = await runCase(config, { bypassLna: true, headless: true });
      if (ok.chip === '200' && /user-local-machine/.test(ok.pane)) {
        report.pass('browser-run.pipeline-200', ok.pane.slice(0, 70));
      } else {
        report.fail('browser-run.pipeline-200', `chip=${ok.chip} err=${(ok.err || '').slice(0, 90)}`);
      }

      // Default Chrome: the permission gate must surface actionable guidance,
      // not the old misleading 15s timeout.
      const denied = await runCase(config, { bypassLna: false, headless: true });
      const msg = denied.err || '';
      if (mainIsLoopback(config.MAIN)) {
        report.warn('browser-run.lna-guidance', 'skipped: E2E_MAIN is a loopback origin, gate cannot fire');
      } else {
        report[/Local Network Access/.test(msg) ? 'pass' : 'fail'](
          'browser-run.lna-guidance',
          /Local Network Access/.test(msg) ? 'shows Local Network Access guidance' : `err=${msg.slice(0, 110)}`
        );
      }
      report[/15000ms/.test(msg) ? 'fail' : 'pass'](
        'browser-run.no-stale-timeout',
        /15000ms/.test(msg) ? 'stale 15s timeout text present' : 'ok'
      );
    } catch (e) {
      report.fail('browser-run', e.message.slice(0, 160));
    } finally {
      srv.kill();
    }
  },
};
