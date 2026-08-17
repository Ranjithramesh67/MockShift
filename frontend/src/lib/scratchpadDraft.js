'use strict';

/**
 * M14: full-width scratchpad draft.
 *
 * Holds the in-memory request shape edited by the scratchpad editor (a plain
 * JS object, never persisted to the server) and converts it into the two wire
 * formats the app needs:
 *
 *   - `scratchDraftToRunInput(draft)` maps the draft into the ephemeral run
 *     payload accepted by `contentApi.runEphemeral` (the `POST /api/runs`
 *     endpoint), so a scratchpad request can be executed without saving it.
 *
 *   - `scratchDraftToServerPatch(draft)` maps the draft into the server
 *     request patch accepted by `contentApi.updateRequest` (used right after
 *     `createRequest` to persist a saved scratchpad).
 *
 * Both converters are pure and defensive: they never mutate the draft and
 * always produce a well-shaped payload even when the draft is missing fields.
 */

/**
 * The default scratchpad draft shape, mirroring the fields the editor binds.
 *
 * @returns {{
 *   method: string,
 *   url: string,
 *   headers: Array<{ key: string; value: string; enabled: boolean }>,
 *   queryParams: Array<{ key: string; value: string; enabled: boolean }>,
 *   bodyType: 'NONE'|'JSON'|'FORM_URLENCODED'|'MULTIPART'|'RAW_TEXT'|'GRAPHQL',
 *   bodyJson: string | null,
 *   bodyText: string | null,
 *   contentType: string,
 *   apiType: 'REST'|'SOAP'|'GRAPHQL'|'AUTH',
 *   formula: string,
 *   assertions: Array<{ id: string; type: string; operator: string; path?: string; expected?: string }>,
 * }}
 */
function defaultScratchDraft() {
  return {
    method: 'GET',
    url: '',
    headers: [],
    queryParams: [],
    bodyType: 'NONE',
    bodyJson: null,
    bodyText: null,
    contentType: 'text/plain',
    apiType: 'REST',
    formula: '',
    assertions: [],
  };
}

/**
 * Convert a scratchpad draft into the ephemeral run payload.
 *
 * For a JSON body the serialized editor body (`bodyJson`, a string) is parsed
 * into an object when possible; on parse failure the raw string is passed
 * through as `bodyJson` alongside `bodyText`.
 *
 * @param {object} draft
 * @returns {{
 *   method: string,
 *   url: string,
 *   headers: Array<{ key: string; value: string; enabled: boolean }>,
 *   queryParams: Array<{ key: string; value: string; enabled: boolean }>,
 *   bodyType: string,
 *   bodyJson: unknown,
 *   bodyText: string | null,
 *   formula: string,
 *   assertions: Array<object>,
 *   apiType: string,
 * }}
 */
function scratchDraftToRunInput(draft) {
  const bodyJsonRaw = draft.bodyJson ?? null;
  let bodyJson = bodyJsonRaw;
  if (
    draft.bodyType === 'JSON' &&
    typeof bodyJsonRaw === 'string' &&
    bodyJsonRaw.length > 0
  ) {
    try {
      bodyJson = JSON.parse(bodyJsonRaw);
    } catch {
      bodyJson = bodyJsonRaw;
    }
  }
  return {
    method: String(draft.method || 'GET'),
    url: String(draft.url ?? ''),
    headers: Array.isArray(draft.headers) ? draft.headers : [],
    queryParams: Array.isArray(draft.queryParams) ? draft.queryParams : [],
    bodyType: draft.bodyType ?? 'NONE',
    bodyJson,
    bodyText: draft.bodyText ?? null,
    formula: draft.formula || '',
    assertions: Array.isArray(draft.assertions) ? draft.assertions : [],
    apiType: draft.apiType ?? 'REST',
  };
}

/**
 * Convert a scratchpad draft into the server request patch.
 *
 * JSON bodies follow the same convention as `toServerPatch` in the workspace
 * store: a parseable JSON string becomes a `bodyJson` object, an unparseable
 * one falls back to `bodyText`, and an empty/absent body clears both. Any
 * other body type moves the text into `bodyText` with `bodyJson` null.
 *
 * @param {object} draft
 * @returns {Record<string, unknown>}
 */
function scratchDraftToServerPatch(draft) {
  const patch = {
    headers: Array.isArray(draft.headers) ? draft.headers : [],
    queryParams: Array.isArray(draft.queryParams) ? draft.queryParams : [],
    bodyType: draft.bodyType ?? 'NONE',
    formula: draft.formula || '',
    assertions: draft.assertions ?? [],
  };
  if (draft.bodyType === 'JSON') {
    const bodyJson = draft.bodyJson ?? null;
    if (typeof bodyJson === 'string' && bodyJson.length > 0) {
      try {
        patch.bodyJson = JSON.parse(bodyJson);
      } catch {
        patch.bodyJson = null;
        patch.bodyText = bodyJson;
      }
    } else {
      patch.bodyJson = null;
      patch.bodyText = null;
    }
  } else {
    patch.bodyText = draft.bodyJson ?? null;
    patch.bodyJson = null;
  }
  return patch;
}

module.exports = { defaultScratchDraft, scratchDraftToRunInput, scratchDraftToServerPatch };
