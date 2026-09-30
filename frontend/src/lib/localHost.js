'use strict';

// Classification of "local" hosts for browser-executed runs. Kept as plain JS
// (like multipartParts.js) so it can be unit-tested directly and imported by
// both the browser runner and the workspace store.
//
// Requests to these hosts can only succeed from the caller's own network:
// loopback (127.0.0.0/8, ::1, localhost), RFC1918 private ranges (10/8,
// 172.16/12, 192.168/16) and IPv6 unique-local (fc00::/7).

function isLocalHostname(hostname) {
  const host = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  return false;
}

function isLocalUrl(rawUrl) {
  try {
    return isLocalHostname(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

// Cheap pre-check on the RAW (unsubstituted) url: does it look local, or does it
// contain a variable that might resolve to a local host? Used to skip the
// prepare round-trip for requests that clearly point at a public host.
const MAYBE_LOCAL_RE =
  /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\{\{/i;

function maybeLocal(rawUrl) {
  return MAYBE_LOCAL_RE.test(rawUrl || '');
}

module.exports = { isLocalHostname, isLocalUrl, maybeLocal };
