'use strict';

function tokenFromSearch(search) {
  const raw = String(search || '').replace(/^\?/, '');
  if (!raw) return null;
  for (const part of raw.split('&')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    if (part.slice(0, idx) === 'token') {
      let value;
      try {
        value = decodeURIComponent(part.slice(idx + 1));
      } catch {
        return null;
      }
      return value || null;
    }
  }
  return null;
}

function passwordProblem(password, confirm) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value !== String(confirm || '')) return 'Passwords do not match';
  return null;
}

module.exports = { tokenFromSearch, passwordProblem };
