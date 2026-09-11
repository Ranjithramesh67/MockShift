'use strict';

// ---------------------------------------------------------------------------
// Email-domain classification for account identity.
//
// A signup is treated as an individual ("general public") when the email uses
// a well-known consumer/free mail provider, and as an organization member when
// it uses a company domain. This is the single source of truth used by both
// the main-app signup path and Portal A checkout so they never diverge.
//
// Two env overrides are honoured (comma-separated, lower-case):
//   PERSONAL_EMAIL_DOMAINS — extra domains that count as personal
//   COMPANY_EMAIL_DOMAINS  — domains forced to COMPANY even if listed above
// ---------------------------------------------------------------------------

const PERSONAL_EMAIL_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'outlook.com', 'outlook.co.uk', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
  'hotmail.de', 'hotmail.it', 'hotmail.es', 'live.com', 'live.co.uk',
  'live.com.au', 'live.ca', 'live.fr', 'live.de', 'live.it', 'msn.com',
  'passport.com',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.com.au', 'yahoo.ca',
  'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.es', 'yahoo.com.br', 'yahoo.co.jp',
  'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // AOL / legacy
  'aol.com', 'aol.co.uk', 'aim.com', 'verizon.net', 'comcast.net', 'att.net',
  'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
  // Privacy-focused
  'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io',
  'fastmail.com', 'fastmail.fm', 'hey.com', 'hushmail.com', 'startmail.com',
  'disroot.org', 'riseup.net', 'mailfence.com', 'zoho.com', 'zohomail.com',
  // Other international consumer providers
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch', 'web.de', 't-online.de',
  'freenet.de', 'mail.com', 'email.com', 'mail.ru', 'inbox.ru', 'list.ru',
  'bk.ru', 'rambler.ru', 'yandex.ru', 'yandex.com', 'ya.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'sina.cn', 'sohu.com',
  'foxmail.com', 'aliyun.com', 'naver.com', 'daum.net', 'hanmail.net',
  'nate.com', 'kakao.com',
  'rediffmail.com', 'rediff.com', 'indiatimes.com', 'sify.com',
  'orange.fr', 'laposte.net', 'free.fr', 'sfr.fr', 'wanadoo.fr', 'bbox.fr',
  'libero.it', 'virgilio.it', 'alice.it', 'tin.it', 'tiscali.it', 'virgilio.it',
  'terra.com.br', 'uol.com.br', 'bol.com.br', 'ig.com.br', 'globo.com',
  'globomail.com', 'zipmail.com.br',
  'seznam.cz', 'centrum.cz', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl',
  'telenet.be', 'skynet.be', 'bluewin.ch', 'libero.it',
]);

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Reserved / special-use domains (RFC 2606, RFC 6761) plus the well-known
// test domains this project's suites and seeds use. Nobody should auto-join a
// shared "company" org because they both signed up as @test.io, so these are
// always treated as individual accounts.
const SPECIAL_USE_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'example.edu', 'example.io',
  'test.com', 'test.io', 'test.net', 'localhost', 'invalid', 'local',
]);
const SPECIAL_USE_SUFFIXES = ['.test', '.example', '.invalid', '.localhost'];

function isSpecialUseDomain(domain) {
  if (!domain) return true;
  if (SPECIAL_USE_DOMAINS.has(domain)) return true;
  return SPECIAL_USE_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

function personalExtra() {
  return parseList(process.env.PERSONAL_EMAIL_DOMAINS);
}

function companyOverride() {
  return parseList(process.env.COMPANY_EMAIL_DOMAINS);
}

/**
 * Lower-cased domain part of an email, or null when there is no usable domain.
 * Only the last `@` split matters so odd local parts are tolerated.
 */
function normalizeEmailDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 0 || at === value.length - 1) return null;
  const domain = value.slice(at + 1).replace(/\.+$/, '');
  if (!domain || !domain.includes('.')) return null;
  return domain;
}

function isPersonalDomain(domain) {
  if (!domain) return true; // unknown/garbage -> safest is the restricted tier
  if (companyOverride().includes(domain)) return false;
  if (isSpecialUseDomain(domain)) return true;
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return true;
  return personalExtra().includes(domain);
}

/**
 * Classify an email address.
 * @returns {{ email: string, domain: string|null,
 *             accountType: 'PERSONAL'|'COMPANY', isPersonal: boolean }}
 */
function classifyEmail(email) {
  const domain = normalizeEmailDomain(email);
  const isPersonal = isPersonalDomain(domain);
  return {
    email: String(email || '').trim().toLowerCase(),
    domain,
    accountType: isPersonal ? 'PERSONAL' : 'COMPANY',
    isPersonal,
  };
}

/**
 * Human-friendly organization name from a company domain: `acme-corp.com`
 * -> `Acme Corp`. Falls back to the raw domain when it has no usable label.
 */
function companyNameFromDomain(domain) {
  const label = String(domain || '').split('.')[0] || '';
  const name = label.replace(/[-_]+/g, ' ').trim();
  if (!name) return String(domain || 'Company');
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

module.exports = {
  PERSONAL_EMAIL_DOMAINS,
  normalizeEmailDomain,
  isSpecialUseDomain,
  isPersonalDomain,
  classifyEmail,
  companyNameFromDomain,
};
