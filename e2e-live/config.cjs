'use strict';

// Shared configuration for the live end-to-end suite. Values come from the
// environment; an optional gitignored e2e-live/.env.local is loaded first so
// the suite "just works" on a machine that has been set up.

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ENV_LOCAL = path.join(HERE, '.env.local');
if (fs.existsSync(ENV_LOCAL)) {
  for (const line of fs.readFileSync(ENV_LOCAL, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

const LOCAL_PORT = Number(process.env.E2E_LOCAL_PORT || 8082);

module.exports = {
  MAIN: process.env.E2E_MAIN || 'https://mockshift.keerainnovations.com',
  PORTAL: process.env.E2E_PORTAL || 'https://mockshift-portal.keerainnovations.com',
  BOSS: {
    email: process.env.E2E_BOSS_EMAIL || 'boss1785867669@test.io',
    pass: process.env.E2E_BOSS_PASS || '',
  },
  SUPER: {
    email: process.env.E2E_SUPER_EMAIL || 'superadmin@mockshift.dev',
    pass: process.env.E2E_SUPER_PASS || '',
  },
  PW: process.env.E2E_PW || path.resolve(HERE, '..', 'frontend', 'node_modules', 'playwright-core'),
  CHROMIUM:
    process.env.E2E_CHROMIUM || '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  ARTIFACTS: process.env.E2E_ARTIFACTS || path.join(HERE, 'artifacts'),
  HEADED: process.env.E2E_HEADED === '1',
  LOCAL_PORT,
  LOCAL_URL: process.env.E2E_LOCAL_URL || `http://localhost:${LOCAL_PORT}`,
  // Chrome 142+ gates public-site -> loopback fetches behind the "Local Network
  // Access" permission prompt. Automation cannot answer the prompt, so the
  // functional browser-run check disables the gate; the message check relies on
  // the headless auto-deny path.
  LNA_BYPASS_FEATURES:
    'LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,' +
    'PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests',
};
