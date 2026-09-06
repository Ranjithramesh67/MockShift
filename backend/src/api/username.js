'use strict';

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,29}$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function usernameError(username) {
  if (!username) return 'Username is required';
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3–30 characters, start with a letter, and use only letters, numbers, and underscores';
  }
  return null;
}

function deriveUsername(email, name) {
  const local = String(email || '').split('@')[0] || '';
  let raw = local.replace(/[^A-Za-z0-9_]/g, '');
  if (!/^[A-Za-z]/.test(raw)) raw = `u${raw}`;
  if (raw.length < 3) {
    const fromName = String(name || '').replace(/[^A-Za-z0-9_]/g, '');
    raw = fromName && /^[A-Za-z]/.test(fromName) ? fromName : `user${raw}`;
  }
  if (raw.length < 3) raw = 'user';
  return raw.slice(0, 30);
}

async function usernameTaken(exec, username) {
  const { rows } = await exec('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
  return rows.length > 0;
}

async function allocateUsername(exec, { username, email, name }) {
  const requested = String(username || '').trim();
  if (requested) {
    const err = usernameError(requested);
    if (err) throw httpError(400, err);
    if (await usernameTaken(exec, requested)) {
      throw httpError(409, 'That username is already taken');
    }
    return requested;
  }
  let base = deriveUsername(email, name);
  if (!USERNAME_RE.test(base)) base = 'user';
  let candidate = base;
  let n = 2;
  while (await usernameTaken(exec, candidate)) {
    const suffix = String(n++);
    candidate = `${base.slice(0, Math.max(1, 30 - suffix.length))}${suffix}`;
  }
  return candidate;
}

module.exports = { USERNAME_RE, usernameError, allocateUsername };
