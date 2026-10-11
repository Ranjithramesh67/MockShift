'use strict';

/**
 * M8: scratchpad ("test cURL without saving"). Maps a parsed cURL command into
 * the in-memory request shape accepted by the ephemeral `POST /api/runs`
 * endpoint, so a pasted cURL can be executed without creating or saving a
 * request. The response is surfaced through the workspace `lastRun` state.
 */

function scratchpadRequest(parsed, { collectionId = null } = {}) {
  return {
    method: parsed.method || 'GET',
    url: parsed.url || '',
    headers: Array.isArray(parsed.headers) ? parsed.headers : [],
    queryParams: Array.isArray(parsed.queryParams) ? parsed.queryParams : [],
    bodyType: parsed.bodyType || 'NONE',
    bodyJson: parsed.bodyJson ?? parsed.bodyText ?? null,
    bodyText: parsed.bodyText ?? null,
    apiType: parsed.apiType || 'REST',
    collectionId,
    persistHistory: false,
  };
}

module.exports = { scratchpadRequest };
