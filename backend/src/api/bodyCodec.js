'use strict';

function methodsWithoutBody(method) {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

function defaultContentType({ bodyType, apiType } = {}) {
  const bt = String(bodyType || 'NONE').toUpperCase();
  const at = String(apiType || 'REST').toUpperCase();
  if (bt === 'JSON' || bt === 'GRAPHQL') return 'application/json';
  if (bt === 'FORM_URLENCODED') return 'application/x-www-form-urlencoded';
  if (bt === 'MULTIPART') return 'multipart/form-data';
  if (bt === 'XML' || at === 'SOAP') return at === 'SOAP' ? 'text/xml' : 'application/xml';
  return 'text/plain';
}

function ensureSoapEnvelope(xml) {
  const src = String(xml || '').trim();
  if (!src) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body/>\n</soap:Envelope>';
  }
  if (/<(?:\w+:)?Envelope\b/i.test(src)) return src;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n${src}\n  </soap:Body>\n</soap:Envelope>`;
}

function graphqlPayload(request, substitute, vars) {
  const rawJson = request.body_json;
  if (rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)) {
    const query = substitute(String(rawJson.query ?? ''), vars);
    const out = { query };
    if (rawJson.variables !== undefined) out.variables = rawJson.variables;
    if (rawJson.operationName) out.operationName = substitute(String(rawJson.operationName), vars);
    return out;
  }
  const text = substitute(String(request.body_text ?? (typeof rawJson === 'string' ? rawJson : '') ?? ''), vars);
  if (!text) return { query: '' };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && ('query' in parsed || 'variables' in parsed)) return parsed;
  } catch {
    /* raw query document */
  }
  return { query: text };
}

function serializeBody(request, { substitute = (s) => s, vars = {} } = {}) {
  const bodyType = String(request.body_type || 'NONE').toUpperCase();
  const apiType = String(request.api_type || 'REST').toUpperCase();
  if (bodyType === 'NONE') return { body: null, contentType: null, snapshot: null };
  if (bodyType === 'GRAPHQL') {
    const payload = graphqlPayload(request, substitute, vars);
    const body = JSON.stringify(payload);
    return { body, contentType: 'application/json', snapshot: payload };
  }
  if (bodyType === 'JSON' && request.body_json && typeof request.body_json === 'object') {
    const body = JSON.stringify(request.body_json);
    return { body, contentType: 'application/json', snapshot: request.body_json };
  }
  let text = request.body_text ?? (typeof request.body_json === 'string' ? request.body_json : null);
  if (text == null) return { body: null, contentType: null, snapshot: null };
  text = substitute(String(text), vars);
  if (bodyType === 'XML' || apiType === 'SOAP') {
    const body = apiType === 'SOAP' ? ensureSoapEnvelope(text) : text;
    return {
      body,
      contentType: defaultContentType({ bodyType: 'XML', apiType }),
      snapshot: body,
    };
  }
  return { body: text, contentType: defaultContentType({ bodyType, apiType }), snapshot: text };
}

module.exports = {
  methodsWithoutBody,
  defaultContentType,
  serializeBody,
  ensureSoapEnvelope,
  graphqlPayload,
};
