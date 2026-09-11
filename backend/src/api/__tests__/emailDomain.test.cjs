'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmailDomain,
  isPersonalDomain,
  classifyEmail,
  companyNameFromDomain,
} = require('../emailDomain');

test('normalizes the domain, ignoring case and trailing dots', () => {
  assert.equal(normalizeEmailDomain('Alice@Gmail.COM'), 'gmail.com');
  assert.equal(normalizeEmailDomain('bob@Acme.co.UK.'), 'acme.co.uk');
  assert.equal(normalizeEmailDomain('no-at-sign'), null);
  assert.equal(normalizeEmailDomain('trailing@'), null);
  assert.equal(normalizeEmailDomain('nodot@localhost'), null);
  assert.equal(normalizeEmailDomain(''), null);
  assert.equal(normalizeEmailDomain(null), null);
});

test('classifies well-known consumer providers as PERSONAL', () => {
  for (const email of [
    'a@gmail.com',
    'b@yahoo.co.uk',
    'c@outlook.com',
    'd@hotmail.de',
    'e@icloud.com',
    'f@proton.me',
    'g@qq.com',
    'h@yandex.ru',
  ]) {
    const c = classifyEmail(email);
    assert.equal(c.isPersonal, true, email);
    assert.equal(c.accountType, 'PERSONAL', email);
  }
});

test('classifies company domains as COMPANY', () => {
  for (const email of ['dev@acme.com', 'ops@acme-corp.io', 'x@sub.example.org']) {
    const c = classifyEmail(email);
    assert.equal(c.isPersonal, false, email);
    assert.equal(c.accountType, 'COMPANY', email);
    assert.ok(c.domain, email);
  }
});

test('unknown or malformed domains fall back to PERSONAL (safe default)', () => {
  assert.equal(classifyEmail('x@localhost').accountType, 'PERSONAL');
  assert.equal(classifyEmail('garbage').accountType, 'PERSONAL');
});

test('reserved, example and project test domains are PERSONAL', () => {
  for (const email of [
    'admin@test.io',
    'a@example.com',
    'b@example.org',
    'c@foo.test',
    'd@bar.example',
    'e@baz.invalid',
  ]) {
    assert.equal(classifyEmail(email).accountType, 'PERSONAL', email);
  }
});

test('env overrides extend personal and force company', () => {
  const prevPersonal = process.env.PERSONAL_EMAIL_DOMAINS;
  const prevCompany = process.env.COMPANY_EMAIL_DOMAINS;
  try {
    process.env.PERSONAL_EMAIL_DOMAINS = 'mycorp.dev';
    assert.equal(isPersonalDomain('mycorp.dev'), true);

    process.env.COMPANY_EMAIL_DOMAINS = 'gmail.com';
    assert.equal(isPersonalDomain('gmail.com'), false);
    assert.equal(classifyEmail('a@gmail.com').accountType, 'COMPANY');
  } finally {
    if (prevPersonal === undefined) delete process.env.PERSONAL_EMAIL_DOMAINS;
    else process.env.PERSONAL_EMAIL_DOMAINS = prevPersonal;
    if (prevCompany === undefined) delete process.env.COMPANY_EMAIL_DOMAINS;
    else process.env.COMPANY_EMAIL_DOMAINS = prevCompany;
  }
});

test('companyNameFromDomain produces a friendly label', () => {
  assert.equal(companyNameFromDomain('acme.com'), 'Acme');
  assert.equal(companyNameFromDomain('acme-corp.io'), 'Acme Corp');
  assert.equal(companyNameFromDomain('my_team.dev'), 'My Team');
  assert.equal(companyNameFromDomain(''), 'Company');
});
