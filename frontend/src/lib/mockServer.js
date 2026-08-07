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

/**
 * Public URL a project's mock server is served at. The backend mounts the
 * public dispatcher at /mock/:projectId/*.
 */
function mockBaseUrl(projectId) {
  return `http://127.0.0.1:3001/mock/${projectId}`;
}

module.exports = { parseMockHeaders, mockBaseUrl };
