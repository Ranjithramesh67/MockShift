'use strict';

// Default request body shown for each API type in the create/edit request
// editor. Keeping the seed text in one place lets the create modal swap the
// body content when the user picks a different type: REST and GraphQL use JSON,
// SOAP uses an XML envelope, Auth uses a client-credentials JSON body.

const SOAP_SEED = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetUser><id>1</id></GetUser>
  </soap:Body>
</soap:Envelope>`;

const GRAPHQL_SEED = JSON.stringify({ query: 'query { ping }', variables: {} }, null, 2);

const REST_SEED = `{
  "key": "value"
}`;

const AUTH_SEED = `{
  "grant_type": "client_credentials",
  "client_id": "your-client-id",
  "client_secret": "your-client-secret"
}`;

// `bodySel` mirrors the create modal's BodySel union ('JSON' | 'XML' | 'RAW_TEXT').
const API_BODY_PRESETS = {
  REST: { bodySel: 'JSON', bodyText: REST_SEED },
  SOAP: { bodySel: 'XML', bodyText: SOAP_SEED },
  GRAPHQL: { bodySel: 'JSON', bodyText: GRAPHQL_SEED },
  AUTH: { bodySel: 'JSON', bodyText: AUTH_SEED },
};

const PRESET_TEXTS = new Set(Object.values(API_BODY_PRESETS).map((p) => p.bodyText.trim()));

// Methods that conventionally carry a request body. GET/DELETE/HEAD/OPTIONS
// hide the Body tab and edit query params instead. QUERY is GET-like but
// intentionally carries a body (RFC 10008), so it shows the Body tab.
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'QUERY'];

/** @param {string} method */
function isBodyMethod(method) {
  return BODY_METHODS.includes(method);
}

/** @param {string} apiType */
function bodyPresetForApiType(apiType) {
  return API_BODY_PRESETS[apiType] || null;
}

/**
 * A body is "pristine" when it is empty or still exactly one of the seed
 * samples, i.e. the user has not typed their own content yet. Only pristine
 * bodies are replaced when the API type changes.
 * @param {unknown} text
 */
function isPresetBodyText(text) {
  if (text == null) return true;
  const trimmed = String(text).trim();
  return trimmed === '' || PRESET_TEXTS.has(trimmed);
}

/**
 * Compute the editor changes when the user picks an API type: the method to
 * use (body-driven types move a body-less method to POST), the body kind, and
 * the body text. The body is only replaced when it is empty or still an
 * untouched seed; content the user typed is preserved.
 *
 * @param {{ apiType: string }} next
 * @param {{ method: string, bodyText: unknown }} current
 * @returns {{ method: string, bodySel: string | null, bodyText: string, bodyChanged: boolean, bodyTabAvailable: boolean }}
 */
function resolveApiTypeSwitch(next, current) {
  const preset = bodyPresetForApiType(next.apiType);
  const method =
    next.apiType !== 'REST' && !isBodyMethod(current.method) ? 'POST' : current.method;
  const bodyChanged = Boolean(preset && isPresetBodyText(current.bodyText));
  return {
    method,
    bodySel: preset ? preset.bodySel : null,
    bodyText: bodyChanged ? preset.bodyText : String(current.bodyText ?? ''),
    bodyChanged,
    bodyTabAvailable: isBodyMethod(method),
  };
}

module.exports = {
  API_BODY_PRESETS,
  BODY_METHODS,
  bodyPresetForApiType,
  isBodyMethod,
  isPresetBodyText,
  resolveApiTypeSwitch,
};
