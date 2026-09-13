'use strict';

// ---------------------------------------------------------------------------
// Best-effort transactional email. Configured entirely from the environment so
// no credential is ever committed:
//   SMTP_URL                    e.g. smtp://user:pass@host:587 (alternative to host/port)
//   SMTP_HOST, SMTP_PORT        default 587
//   SMTP_SECURE=1               implicit TLS (usually port 465)
//   SMTP_USER, SMTP_PASS
//   SMTP_FROM                   default "API Hub <noreply@keerainnovations.com>"
//   APP_URL                     public base URL used to build links (default http://localhost:3000)
// ---------------------------------------------------------------------------

function smtpConfig() {
  const url = process.env.SMTP_URL;
  const host = process.env.SMTP_HOST;
  if (!url && !host) return null;
  return {
    url,
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  };
}

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function fromAddress() {
  return process.env.SMTP_FROM || 'API Hub <noreply@keerainnovations.com>';
}

let transportOverride;

function buildTransport(cfg) {
  // Lazy require keeps the server bootable if the optional dependency is absent.
  const nodemailer = require('nodemailer');
  if (cfg.url) return nodemailer.createTransport(cfg.url);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
  });
}

function getTransport() {
  if (transportOverride !== undefined) return transportOverride;
  const cfg = smtpConfig();
  if (!cfg) return null;
  try {
    return buildTransport(cfg);
  } catch (err) {
    console.error('[email] transport init failed:', err.message);
    return null;
  }
}

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    console.log(`[email] SMTP not configured; skipped "${subject}"`);
    return { skipped: true };
  }
  try {
    const info = await transport.sendMail({ from: fromAddress(), to, subject, text, html });
    return { skipped: false, messageId: info && info.messageId };
  } catch (err) {
    console.error(`[email] send failed for "${subject}":`, redact(err && err.message));
    return { skipped: false, error: err.message };
  }
}

// Best-effort scrub of anything that looks like URL userinfo credentials
// (e.g. smtp://user:pass@host) before writing an error to the log.
function redact(text) {
  return String(text || '').replace(/\/\/[^@\s/]*@/g, '//***@');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function passwordResetMessage(link) {
  const href = escapeHtml(link);
  return {
    subject: 'Reset your API Hub password',
    text: `We received a request to reset your API Hub password.\n\nOpen this link to choose a new password:\n${link}\n\nThis link expires in 1 hour. If you did not request it, you can ignore this email.`,
    html: `<p>We received a request to reset your API Hub password.</p><p><a href="${href}">Choose a new password</a></p><p>This link expires in 1 hour. If you did not request it, you can ignore this email.</p>`,
  };
}

function verifyEmailMessage(link) {
  const href = escapeHtml(link);
  return {
    subject: 'Verify your API Hub email',
    text: `Welcome to API Hub.\n\nConfirm your email address:\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome to API Hub.</p><p><a href="${href}">Confirm your email address</a></p><p>This link expires in 24 hours.</p>`,
  };
}

function setTransportForTest(transport) {
  transportOverride = transport;
}

function resetTransportForTest() {
  transportOverride = undefined;
}

module.exports = {
  smtpConfig,
  appUrl,
  fromAddress,
  sendMail,
  passwordResetMessage,
  verifyEmailMessage,
  setTransportForTest,
  resetTransportForTest,
};
