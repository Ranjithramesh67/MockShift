'use strict';

// Live end-to-end suite runner. Usage:
//   node e2e-live/run-all.cjs
//   E2E_ONLY=login,browser-run node e2e-live/run-all.cjs
//   E2E_HEADED=1 E2E_ONLY=functional node e2e-live/run-all.cjs

const fs = require('fs');
const path = require('path');
const config = require('./config.cjs');
const { createReport, renderSummary } = require('./lib/report.cjs');
const { launch } = require('./lib/browser.cjs');

const SUITES = [
  './suites/01-login.cjs',
  './suites/02-routes.cjs',
  './suites/03-admin.cjs',
  './suites/04-functional.cjs',
  './suites/05-browser-run.cjs',
  './suites/06-api-validation.cjs',
  './suites/07-mobile.cjs',
];

async function main() {
  fs.mkdirSync(config.ARTIFACTS, { recursive: true });
  const report = createReport();
  const only = (process.env.E2E_ONLY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const browser = await launch(config);
  try {
    for (const rel of SUITES) {
      const mod = require(rel);
      if (only.length && !only.includes(mod.name)) continue;
      process.stdout.write(`\n[suite] ${mod.name}\n`);
      try {
        await mod.run({ config, browser, report });
      } catch (e) {
        report.fail(`${mod.name}.fatal`, e.message.slice(0, 200));
      }
    }
  } finally {
    await browser.close();
  }

  console.log(renderSummary(report));
  const c = report.counts();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(config.ARTIFACTS, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), target: config.MAIN, results: report.results }, null, 2)
  );
  const md = [
    '# Live E2E report',
    '',
    `Date: ${new Date().toISOString()}`,
    `Target: ${config.MAIN}`,
    '',
    `Totals: pass=${c.pass} fail=${c.fail} warn=${c.warn}`,
    '',
    '| Status | Check | Detail |',
    '|---|---|---|',
    ...report.results.map((r) => `| ${r.status} | ${r.id} | ${(r.detail || '').replace(/\|/g, '\\|')} |`),
  ].join('\n');
  fs.writeFileSync(path.join(config.ARTIFACTS, `report-${stamp}.md`), md);
  fs.writeFileSync(path.join(config.ARTIFACTS, 'report.md'), md);

  process.exit(c.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
