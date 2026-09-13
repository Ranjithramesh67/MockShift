'use strict';

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = {
  password_reset: 60 * 60 * 1000, // 1 hour
  email_verification: 24 * 60 * 60 * 1000, // 24 hours
};
const KINDS = Object.keys(TOKEN_TTL_MS);

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function ttlFor(kind) {
  return Object.prototype.hasOwnProperty.call(TOKEN_TTL_MS, kind) ? TOKEN_TTL_MS[kind] : null;
}

function expiryFor(kind, now = Date.now()) {
  const ttl = ttlFor(kind);
  return ttl === null ? null : new Date(now + ttl);
}

// Fixed-window in-memory throttle. Good enough to blunt forgot-password abuse
// on a single process; a multi-process deployment would need Redis.
function createThrottle({ windowMs, max }) {
  const hits = new Map();
  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

module.exports = { TOKEN_BYTES, TOKEN_TTL_MS, KINDS, generateToken, hashToken, ttlFor, expiryFor, createThrottle };
