'use strict';

// ---------------------------------------------------------------------------
// Diagnose transactional email without touching the app: loads backend/.env,
// prints the effective (password-redacted) SMTP settings, opens the connection
// with transport.verify(), then sends one message. Exit code 0 only when the
// message was accepted by the server.
//
//   node scripts/send-test-email.js you@example.com
//
// Nothing here is specific to verification mail — it exercises the same
// transport every transactional message uses.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const email = require('../src/api/email');

function redactUrl(url) {
  return String(url).replace(/\/\/[^@\s/]*@/, '//***@');
}

function describeConfig() {
  const cfg = email.smtpConfig();
  if (!cfg) return '(none — neither SMTP_URL nor SMTP_HOST is set in backend/.env)';
  const lines = [];
  if (cfg.url) lines.push(`SMTP_URL  ${redactUrl(cfg.url)}`);
  if (cfg.host) lines.push(`SMTP_HOST ${cfg.host}:${cfg.port}  secure=${cfg.secure}`);
  lines.push(`SMTP_USER ${process.env.SMTP_USER || '(none / anonymous)'}`);
  lines.push(`SMTP_FROM ${email.fromAddress()}`);
  lines.push(`SMTP_TLS  rejectUnauthorized=${cfg.tls.rejectUnauthorized}`);
  lines.push(`APP_URL   ${email.appUrl()}`);
  return lines.join('\n  ');
}

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: node scripts/send-test-email.js <recipient@example.com>');
    process.exit(2);
  }

  console.log('Effective SMTP configuration:\n  ' + describeConfig() + '\n');

  if (!email.isConfigured()) {
    console.error('FAIL: SMTP is not configured, so no email can be sent.');
    console.error('Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM in backend/.env (see .env.example).');
    process.exit(1);
  }

  console.log('Checking the connection (verify)...');
  const verified = await email.verifyTransport();
  if (!verified.ok) {
    console.error('FAIL: could not connect/authenticate:', verified.error || verified.reason);
    process.exit(1);
  }
  console.log(verified.verified === false ? 'OK: transport has no verify(); sending anyway.' : 'OK: connection and credentials accepted.');

  console.log(`Sending a test message to ${to}...`);
  const result = await email.sendMail({
    to,
    subject: 'API Hub SMTP test',
    text: 'This is a test message from API Hub. If you received it, outbound email works.',
  });
  if (result.skipped) {
    console.error('FAIL: skipped — SMTP is not configured.');
    process.exit(1);
  }
  if (result.error) {
    console.error('FAIL: server rejected the message:', result.error);
    process.exit(1);
  }
  console.log(`OK: accepted by the server (messageId ${result.messageId}).`);
}

main().catch((err) => {
  console.error('FAIL:', err && err.message);
  process.exit(1);
});
