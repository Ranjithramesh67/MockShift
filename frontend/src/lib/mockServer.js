'use strict';

/**
 * Parse a headers text field into a plain object. Accepts an empty string
 * (no headers). Throws on non-object / array / invalid JSON.
 */
function parseMockHeaders(raw) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object like {"x-api-key":"value"}');
  }
  return parsed;
}

const DEFAULT_MOCK_REQUEST_ORIGIN = 'http://127.0.0.1:3001';

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * Relative path a project's mock server is served at. Safe to render during
 * SSR (no `window`). The backend mounts the dispatcher at /mock/:projectId/*.
 */
function mockBasePath(projectId) {
  return `/mock/${projectId}`;
}

/**
 * Shareable absolute URL as seen by a browser (through the Next /mock proxy).
 * Falls back to the relative path when no origin is known yet.
 */
function mockBaseUrl(projectId, origin) {
  const host = trimTrailingSlashes(origin);
  return host ? `${host}${mockBasePath(projectId)}` : mockBasePath(projectId);
}

/**
 * Absolute URL the backend request runner can fetch directly when a request is
 * pointed at the mock server. Overridable for deployments.
 */
function mockRequestBaseUrl(projectId) {
  const origin = trimTrailingSlashes(
    process.env.NEXT_PUBLIC_MOCK_REQUEST_ORIGIN || DEFAULT_MOCK_REQUEST_ORIGIN
  );
  return `${origin}${mockBasePath(projectId)}`;
}

module.exports = { parseMockHeaders, mockBasePath, mockBaseUrl, mockRequestBaseUrl };
