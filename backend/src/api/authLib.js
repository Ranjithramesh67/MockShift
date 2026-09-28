'use strict';

const crypto = require('crypto');

const SESSION_COOKIE = 'ah.session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_SECRET = 'dev-only-auth-secret-change-me';

function secret() {
  return process.env.AUTH_SECRET || DEFAULT_SECRET;
}

// ---------------------------------------------------------------------------
// Password hashing (node:crypto scrypt; no external deps). Async so the CPU
// cost of hashing/verifying never blocks the event loop.
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt)).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const derived = await scryptAsync(password, salt);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    derived.length === expectedBuffer.length &&
    crypto.timingSafeEqual(derived, expectedBuffer)
  );
}

// ---------------------------------------------------------------------------
// Session token: base64url(payload).base64url(HMAC-SHA256(payload))
// Payload = { userId, exp }. Stateless, verifiable, no server-side store.
// ---------------------------------------------------------------------------
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSessionToken(userId, sessionEpoch = 0) {
  return signSession({ userId, sv: sessionEpoch, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });
}

// The Secure attribute is added whenever the deployment terminates TLS in
// front of the app (production, or an explicit opt-in for a reverse proxy). It
// stays off for plain-HTTP local/test runs, otherwise the browser would drop
// the cookie.
function secureCookieAttribute() {
  const on =
    process.env.NODE_ENV === 'production' ||
    process.env.COOKIE_SECURE === '1' ||
    process.env.FORCE_SECURE_COOKIES === '1';
  return on ? '; Secure' : '';
}

// The main app and the subscription portal are separate origins that share the
// same users table and session signature (see portal/backend/src/shared.js). A
// host-only cookie never reaches the sibling origin, so the portal would keep
// asking an already-signed-in customer to log in again. Widening the cookie to
// a shared parent domain makes one login work on both:
//   - Production sets COOKIE_DOMAIN explicitly (e.g. `.example.com`).
//   - The online preview serves the apps as `<port>-<session>.monkeycode-ai.live`
//     siblings, so the session-scoped parent (`<session>.monkeycode-ai.live`) is
//     derived from the request host. Only the two ports of the same session
//     share it, never another visitor's session.
// Anything else stays host-only, which is the safe default.
const PREVIEW_HOST_RE = /^\d+-(.+\.monkeycode-ai\.live)$/i;

function requestHost(req) {
  const raw =
    (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  return String(raw).split(',')[0].trim().split(':')[0].toLowerCase();
}

function cookieDomain(req) {
  const explicit = String(process.env.COOKIE_DOMAIN || '').trim();
  if (explicit) return explicit.startsWith('.') ? explicit : `.${explicit}`;
  const host = requestHost(req);
  if (!host) return null;
  const match = PREVIEW_HOST_RE.exec(host);
  return match ? `.${match[1]}` : null;
}

function cookieDomainAttribute(req) {
  const domain = cookieDomain(req);
  return domain ? `; Domain=${domain}` : '';
}

function sessionCookie(token, req) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}${cookieDomainAttribute(req)}${secureCookieAttribute()}`;
}

function clearSessionCookie(req) {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieDomainAttribute(
    req
  )}${secureCookieAttribute()}`;
}

// A session cookie minted before the shared parent domain existed is host-only
// and lingers alongside the new domain-scoped cookie (same name, different
// domain => two distinct cookies). Expire that legacy cookie in the same
// response so exactly one session cookie remains. Never the primary value.
function hostOnlyClearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookieAttribute()}`;
}

function sessionCookieHeaders(token, req) {
  const primary = sessionCookie(token, req);
  return cookieDomain(req) ? [primary, hostOnlyClearCookie()] : primary;
}

function clearSessionCookieHeaders(req) {
  const primary = clearSessionCookie(req);
  return cookieDomain(req) ? [primary, hostOnlyClearCookie()] : primary;
}

function readSessionToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE) {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  createSessionToken,
  sessionCookie,
  clearSessionCookie,
  sessionCookieHeaders,
  clearSessionCookieHeaders,
  cookieDomain,
  readSessionToken,
};
