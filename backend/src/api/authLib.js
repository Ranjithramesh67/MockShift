'use strict';

const crypto = require('crypto');

const SESSION_COOKIE = 'ah.session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_SECRET = 'dev-only-auth-secret-change-me';

function secret() {
  return process.env.AUTH_SECRET || DEFAULT_SECRET;
}

// ---------------------------------------------------------------------------
// Password hashing (node:crypto scrypt; no external deps)
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
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

function createSessionToken(userId) {
  return signSession({ userId, exp: Date.now() + SESSION_TTL_MS });
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
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
  readSessionToken,
};
