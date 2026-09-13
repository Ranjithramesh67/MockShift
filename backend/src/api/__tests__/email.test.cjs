'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const email = require('../email');

test('smtpConfig is null without SMTP env', () => {
  const saved = { ...process.env };
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  assert.equal(email.smtpConfig(), null);
  Object.assign(process.env, saved);
});

test('sendMail is a no-op that resolves when SMTP is unconfigured', async () => {
  const saved = { ...process.env };
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  email.resetTransportForTest();
  const result = await email.sendMail({ to: 'a@b.c', subject: 'x', text: 'y' });
  assert.equal(result.skipped, true);
  Object.assign(process.env, saved);
});

test('sendMail uses the injected transport and never throws on failure', async () => {
  const sent = [];
  email.setTransportForTest({
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: 'mid-1' };
    },
  });
  const ok = await email.sendMail({ to: 'a@b.c', subject: 's', text: 't' });
  assert.equal(ok.skipped, false);
  assert.equal(ok.messageId, 'mid-1');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].from);
  assert.equal(sent[0].to, 'a@b.c');

  email.setTransportForTest({
    sendMail: async () => {
      throw new Error('smtp down');
    },
  });
  const bad = await email.sendMail({ to: 'a@b.c', subject: 's', text: 't' });
  assert.equal(bad.error, 'smtp down');
  email.resetTransportForTest();
});

test('message builders include the link', () => {
  const link = 'http://localhost:3000/reset-password?token=abc';
  assert.ok(email.passwordResetMessage(link).text.includes(link));
  assert.ok(email.verifyEmailMessage(link).html.includes(link));
});

test('appUrl strips a trailing slash', () => {
  const saved = process.env.APP_URL;
  process.env.APP_URL = 'https://app.example.com/';
  assert.equal(email.appUrl(), 'https://app.example.com');
  if (saved === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = saved;
});
