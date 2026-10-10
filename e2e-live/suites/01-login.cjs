'use strict';

const { login, newPage } = require('../lib/browser.cjs');

async function rawLogin(config, body) {
  const res = await fetch(`${config.MAIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

module.exports = {
  name: 'login',
  async run({ config, browser, report }) {
    for (const [id, cred] of [
      ['login.boss-ui', config.BOSS],
      ['login.superadmin-ui', config.SUPER],
    ]) {
      if (!cred.pass) {
        report.warn(id, 'password not set (see e2e-live/.env.example)');
        continue;
      }
      const page = await newPage(browser);
      try {
        await login(page, config.MAIN, cred);
        report.pass(id, page.url().replace(config.MAIN, ''));
      } catch (e) {
        report.fail(id, e.message.slice(0, 140));
      } finally {
        await page._ctx.close();
      }
    }

    // Regression (B2): malformed credentials must be 401, never 500.
    const malformed = [
      ['login.missing-password-401', { email: config.BOSS.email }],
      ['login.null-password-401', { email: config.BOSS.email, password: null }],
      ['login.numeric-password-401', { email: config.BOSS.email, password: 12345 }],
      ['login.unknown-email-401', { email: 'nobody@example.com', password: 'whatever' }],
    ];
    for (const [id, body] of malformed) {
      const r = await rawLogin(config, body);
      if (r.status === 401) report.pass(id, '401');
      else report.fail(id, `expected 401, got ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
    }

    if (config.BOSS.pass) {
      const r = await rawLogin(config, { email: config.BOSS.email, password: config.BOSS.pass });
      report[r.status === 200 ? 'pass' : 'fail']('login.valid-api', String(r.status));
    }

    const ss = await fetch(`${config.MAIN}/api/auth/signup-status`)
      .then((r) => r.json())
      .catch(() => null);
    if (ss && ss.open === false) report.pass('login.signup-closed', 'open=false');
    else report.warn('login.signup-closed', JSON.stringify(ss));
  },
};
