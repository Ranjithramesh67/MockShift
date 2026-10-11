'use strict';

// Pure OpenAPI 3.x helpers for the E1 contract feature: parse/validate a spec,
// generate a collection/folders/requests from its paths, validate a live
// response body against an operation's response schema, and diff two spec
// versions to flag breaking changes. No database or HTTP access here so every
// rule can be unit-tested directly.

const crypto = require('crypto');
const { parseBody } = require('../engine/assertions');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'query'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// --------------------------------------------------------------- spec parsing

function validateSpec(spec) {
  const errors = [];
  if (!isObject(spec)) return ['Spec must be a JSON object'];
  const version = spec.openapi || spec.swagger;
  if (!version) errors.push('Missing "openapi" version');
  else if (!String(version).startsWith('3.')) {
    errors.push(`Unsupported OpenAPI version "${version}" (3.x required)`);
  }
  if (!isObject(spec.info)) errors.push('Missing "info" object');
  else {
    if (!spec.info.title) errors.push('Missing "info.title"');
    if (!spec.info.version) errors.push('Missing "info.version"');
  }
  if (!isObject(spec.paths)) errors.push('Missing "paths" object');
  return errors;
}

function parseSpec(input) {
  let spec = input;
  if (typeof input === 'string') {
    try {
      spec = JSON.parse(input);
    } catch (err) {
      throw new Error(`Invalid JSON spec: ${err.message}`);
    }
  }
  const errors = validateSpec(spec);
  if (errors.length) throw new Error(errors.join('; '));
  return spec;
}

// ------------------------------------------------------------ $ref resolution

function resolvePointer(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined;
  const parts = ref
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cursor = spec;
  for (const part of parts) {
    if (part === '') continue;
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function deref(spec, node, seen) {
  if (!isObject(node) || typeof node.$ref !== 'string') return node;
  const visited = seen || new Set();
  if (visited.has(node.$ref)) return node;
  visited.add(node.$ref);
  const target = resolvePointer(spec, node.$ref);
  if (target === undefined) return node;
  return deref(spec, target, visited);
}

// Resolve a chain of schema $refs down to a concrete schema object.
function derefSchema(spec, schema) {
  let current = schema;
  const visited = new Set();
  while (isObject(current) && typeof current.$ref === 'string') {
    if (visited.has(current.$ref)) break;
    visited.add(current.$ref);
    const resolved = resolvePointer(spec, current.$ref);
    if (!isObject(resolved)) break;
    current = resolved;
  }
  return current;
}

// --------------------------------------------------------------- normalization

function normalizePath(path) {
  let next = String(path || '').trim();
  if (!next) return '/';
  if (!next.startsWith('/')) next = `/${next}`;
  if (next.length > 1) next = next.replace(/\/+$/, '');
  return next || '/';
}

function normalizeMethod(method) {
  const lower = String(method || '').toLowerCase();
  return HTTP_METHODS.includes(lower) ? lower : null;
}

function normalizeStatusCode(value) {
  if (value === undefined || value === null || value === '') return 'default';
  return String(value);
}

function normalizedPaths(spec) {
  const out = {};
  const paths = isObject(spec.paths) ? spec.paths : {};
  for (const [raw, item] of Object.entries(paths)) out[normalizePath(raw)] = item;
  return out;
}

// --------------------------------------------------------------- generation

function methodEntries(pathItem) {
  const out = [];
  if (!isObject(pathItem)) return out;
  for (const method of HTTP_METHODS) {
    if (isObject(pathItem[method])) out.push([method, pathItem[method]]);
  }
  return out;
}

function folderFor(operation, path) {
  if (Array.isArray(operation.tags) && operation.tags.length && String(operation.tags[0]).trim()) {
    return String(operation.tags[0]).trim();
  }
  const segments = path.split('/').filter(Boolean);
  if (!segments.length) return 'Root';
  const generics = new Set(['api', 'v1', 'v2', 'v3', 'v4']);
  return segments.find((segment) => !generics.has(segment.toLowerCase())) || segments[0];
}

function requestName(operation, method, path) {
  return operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`;
}

function jsonMedia(content) {
  if (!isObject(content)) return null;
  if (isObject(content['application/json'])) return content['application/json'];
  return Object.values(content).find((media) => isObject(media) && media.schema) || null;
}

function firstExample(media) {
  if (!isObject(media)) return undefined;
  if (isObject(media.examples)) {
    for (const example of Object.values(media.examples)) {
      if (isObject(example) && example.value !== undefined) return example.value;
    }
  }
  return media.example;
}

// Turn a spec into a flat collection blueprint: one folder per first tag (or
// first meaningful path segment), one REST request per operation. A JSON
// request body is seeded from the first authored example when present.
function generateRequests(spec, options = {}) {
  const collectionName = options.collectionName || spec.info.title || 'Imported API';
  const folders = new Map();
  const requests = [];
  for (const [path, rawItem] of Object.entries(normalizedPaths(spec))) {
    const item = deref(spec, rawItem);
    for (const [method, rawOperation] of methodEntries(item)) {
      const operation = deref(spec, rawOperation);
      const folder = folderFor(operation, path);
      if (!folders.has(folder)) folders.set(folder, { name: folder });
      const bodyMedia = operation.requestBody ? jsonMedia(operation.requestBody.content) : null;
      const example = bodyMedia ? firstExample(bodyMedia) : undefined;
      requests.push({
        name: requestName(operation, method, path),
        method: method.toUpperCase(),
        path,
        url: `{{baseUrl}}${path}`,
        apiType: 'REST',
        bodyType: bodyMedia ? 'JSON' : 'NONE',
        bodyJson: example === undefined ? null : example,
        folder,
        tags: Array.isArray(operation.tags) ? operation.tags : [],
      });
    }
  }
  return { collectionName, folders: [...folders.values()], requests };
}

// ------------------------------------------------------------- operation lookup

function findOperation(spec, method, path) {
  const lower = normalizeMethod(method);
  if (!lower) return null;
  const wanted = normalizePath(path);
  const paths = normalizedPaths(spec);
  const item = deref(spec, paths[wanted]);
  if (!isObject(item)) return null;
  const operation = item[lower];
  return operation ? deref(spec, operation) : null;
}

function collectOperations(spec) {
  const out = [];
  for (const [path, rawItem] of Object.entries(normalizedPaths(spec))) {
    const item = deref(spec, rawItem);
    for (const [method, rawOperation] of methodEntries(item)) {
      const operation = deref(spec, rawOperation);
      out.push({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId || null,
        summary: operation.summary || null,
        tags: Array.isArray(operation.tags) ? operation.tags : [],
        responseCodes: isObject(operation.responses) ? Object.keys(operation.responses) : [],
        requestSchema: requestSchemaOf(spec, operation),
      });
    }
  }
  return out;
}

function requestSchemaOf(spec, operation) {
  if (!isObject(operation) || !operation.requestBody) return null;
  const media = jsonMedia(operation.requestBody.content);
  return media && media.schema ? derefSchema(spec, media.schema) : null;
}

function schemaFromResponse(spec, response) {
  const resolved = deref(spec, response);
  if (!isObject(resolved)) return null;
  const media = jsonMedia(resolved.content);
  return media && media.schema ? derefSchema(spec, media.schema) : null;
}

// Pick the response definition for a status: exact code, then its XX wildcard,
// then `default`, then the first 2xx. `statusCode` may be 'default' to force
// the default response.
function pickResponse(operation, statusCode) {
  const responses = isObject(operation.responses) ? operation.responses : {};
  const wanted = normalizeStatusCode(statusCode);
  if (wanted !== 'default') {
    if (responses[wanted]) return { key: wanted, response: responses[wanted] };
    const wildcard = `${wanted[0]}XX`;
    if (responses[wildcard]) return { key: wildcard, response: responses[wildcard] };
  }
  if (responses.default) return { key: 'default', response: responses.default };
  const first2xx = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
  if (first2xx) return { key: first2xx, response: responses[first2xx] };
  return null;
}

function getResponseSchema(spec, method, path, statusCode) {
  const operation = findOperation(spec, method, path);
  if (!operation) return null;
  const picked = pickResponse(operation, statusCode);
  if (!picked) return null;
  const schema = schemaFromResponse(spec, picked.response);
  if (!schema) return null;
  return { statusKey: picked.key, schema };
}

// ----------------------------------------------------------- schema validation
// A deliberately small JSON Schema subset: enough for OpenAPI response bodies
// (type, nullable, enum/const, required/properties/additionalProperties, items,
// bounds/pattern, and allOf/anyOf/oneOf). Unknown keywords are ignored.

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(expected, actual) {
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return expected === actual;
}

function typeLabel(type) {
  return Array.isArray(type) ? type.join(' | ') : String(type);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function validateSchema(spec, schema, value, label, errors) {
  const resolved = derefSchema(spec, schema);
  if (!isObject(resolved)) return;
  if (Array.isArray(resolved.allOf)) {
    for (const sub of resolved.allOf) validateSchema(spec, sub, value, label, errors);
  }
  if (Array.isArray(resolved.oneOf) || Array.isArray(resolved.anyOf)) {
    const branches = resolved.oneOf || resolved.anyOf;
    const matched = branches.some((branch) => {
      const branchErrors = [];
      validateSchema(spec, branch, value, label, branchErrors);
      return branchErrors.length === 0;
    });
    if (!matched) errors.push(`${label}: does not match any of the allowed schemas`);
  }
  if (value === null) {
    if (resolved.nullable || resolved.type === 'null' || (Array.isArray(resolved.type) && resolved.type.includes('null'))) {
      return;
    }
    if (resolved.type !== undefined) errors.push(`${label}: expected ${typeLabel(resolved.type)}, got null`);
    return;
  }
  if (resolved.enum && !resolved.enum.some((candidate) => deepEqual(candidate, value))) {
    errors.push(`${label}: value is not one of the allowed enum values`);
  }
  if (resolved.const !== undefined && !deepEqual(resolved.const, value)) {
    errors.push(`${label}: must equal ${JSON.stringify(resolved.const)}`);
  }

  const expected = Array.isArray(resolved.type)
    ? resolved.type.find((type) => type !== 'null')
    : resolved.type;
  const actual = typeOf(value);
  if (expected && !typeMatches(expected, actual)) {
    errors.push(`${label}: expected ${typeLabel(resolved.type)}, got ${actual}`);
    return;
  }

  if (actual === 'object') {
    const properties = isObject(resolved.properties) ? resolved.properties : {};
    if (Array.isArray(resolved.required)) {
      for (const key of resolved.required) {
        if (!(key in value)) errors.push(`${label}.${key}: missing required property`);
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) validateSchema(spec, sub, value[key], `${label}.${key}`, errors);
    }
    if (resolved.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${label}.${key}: additional property not allowed`);
      }
    } else if (isObject(resolved.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          validateSchema(spec, resolved.additionalProperties, value[key], `${label}.${key}`, errors);
        }
      }
    }
  } else if (actual === 'array') {
    if (typeof resolved.minItems === 'number' && value.length < resolved.minItems) {
      errors.push(`${label}: expected at least ${resolved.minItems} items`);
    }
    if (typeof resolved.maxItems === 'number' && value.length > resolved.maxItems) {
      errors.push(`${label}: expected at most ${resolved.maxItems} items`);
    }
    if (resolved.items) {
      value.forEach((item, index) => validateSchema(spec, resolved.items, item, `${label}[${index}]`, errors));
    }
  } else if (actual === 'string') {
    if (typeof resolved.minLength === 'number' && value.length < resolved.minLength) {
      errors.push(`${label}: shorter than ${resolved.minLength} characters`);
    }
    if (typeof resolved.maxLength === 'number' && value.length > resolved.maxLength) {
      errors.push(`${label}: longer than ${resolved.maxLength} characters`);
    }
    if (typeof resolved.pattern === 'string') {
      try {
        if (!new RegExp(resolved.pattern).test(value)) errors.push(`${label}: does not match pattern`);
      } catch {
        // An invalid pattern in the spec is not the response's fault; skip.
      }
    }
  } else if (actual === 'number' || actual === 'integer') {
    if (typeof resolved.minimum === 'number' && value < resolved.minimum) {
      errors.push(`${label}: less than minimum ${resolved.minimum}`);
    }
    if (typeof resolved.maximum === 'number' && value > resolved.maximum) {
      errors.push(`${label}: greater than maximum ${resolved.maximum}`);
    }
  }
}

// Validate a live response against the matching operation response schema.
// Returns { valid, skipped, errors, statusKey }.
function validateResponse(spec, target, response) {
  const method = target.method;
  const path = target.path;
  const statusCode = target.statusCode !== undefined && target.statusCode !== null
    ? target.statusCode
    : response && response.status;
  const found = getResponseSchema(spec, method, path, statusCode);
  if (!found) {
    return { valid: true, skipped: true, errors: [], statusKey: null, message: 'operation has no JSON response schema' };
  }
  const parsed = parseBody(response.body, response.bodyEncoding);
  const errors = [];
  validateSchema(spec, found.schema, parsed, '$', errors);
  return { valid: errors.length === 0, skipped: false, errors, statusKey: found.statusKey };
}

// Evaluate a `contract` assertion (reusing the engine's result shape and body
// parsing) against a resolution context { spec, method?, path?, statusCode? }.
function evaluateContractAssertion(spec, assertion, response) {
  const id = assertion && assertion.id;
  if (!spec) return { id, passed: false, message: 'contract assertion could not resolve its spec' };
  const method = (assertion && assertion.method) || '';
  const path = (assertion && assertion.path) || '';
  const statusCode = assertion && (assertion.statusCode || assertion.expected);
  const result = validateResponse(spec, { method, path, statusCode }, response || {});
  if (result.skipped) {
    return { id, passed: false, message: `contract ${method.toUpperCase()} ${path}: no response schema in spec`, errors: result.errors };
  }
  const passed = result.valid;
  const message = passed
    ? `contract ${method.toUpperCase()} ${path} (${result.statusKey}) matches schema`
    : `contract ${method.toUpperCase()} ${path} (${result.statusKey}) failed: ${result.errors.slice(0, 5).join('; ')}`;
  return { id, passed, message, errors: result.errors, statusKey: result.statusKey };
}

// --------------------------------------------------------------- spec diffing

function schemaType(schema) {
  const resolved = schema;
  if (!isObject(resolved)) return null;
  if (Array.isArray(resolved.type)) return resolved.type.find((type) => type !== 'null') || 'null';
  if (resolved.type) return resolved.type;
  if (resolved.properties) return 'object';
  if (resolved.items) return 'array';
  return null;
}

function diffSchema(baseSpec, headSpec, baseSchema, headSchema, context, push) {
  const base = derefSchema(baseSpec, baseSchema);
  const head = derefSchema(headSpec, headSchema);
  if (!isObject(base) || !isObject(head)) return;

  const baseType = schemaType(base);
  const headType = schemaType(head);
  if (baseType && headType && baseType !== headType) {
    push('breaking', {
      ...context,
      kind: 'field_type_changed',
      severity: 'breaking',
      from: baseType,
      to: headType,
      detail: `${context.label} changed type from ${baseType} to ${headType}`,
    });
  }

  const baseRequired = new Set(Array.isArray(base.required) ? base.required : []);
  const headRequired = new Set(Array.isArray(head.required) ? head.required : []);
  for (const field of baseRequired) {
    if (!headRequired.has(field)) {
      push('breaking', {
        ...context,
        kind: 'required_field_removed',
        severity: 'breaking',
        field,
        detail: `${context.label}.${field} is no longer required`,
      });
    }
  }
  for (const field of headRequired) {
    if (!baseRequired.has(field)) {
      push('non-breaking', {
        ...context,
        kind: 'required_field_added',
        severity: 'non-breaking',
        field,
        detail: `${context.label}.${field} is now required`,
      });
    }
  }

  const baseProps = isObject(base.properties) ? base.properties : {};
  const headProps = isObject(head.properties) ? head.properties : {};
  for (const field of Object.keys(baseProps)) {
    if (!(field in headProps)) {
      push('breaking', {
        ...context,
        kind: 'field_removed',
        severity: 'breaking',
        field,
        detail: `${context.label}.${field} was removed`,
      });
      continue;
    }
    diffSchema(
      baseSpec,
      headSpec,
      baseProps[field],
      headProps[field],
      { ...context, label: `${context.label}.${field}`, field },
      push
    );
  }

  if (base.items && head.items) {
    diffSchema(baseSpec, headSpec, base.items, head.items, { ...context, label: `${context.label}[]` }, push);
  }
}

function diffOperation(baseSpec, headSpec, baseOp, headOp, method, path, push) {
  const baseRequestBody = requestSchemaOf(baseSpec, baseOp);
  const headRequestBody = requestSchemaOf(headSpec, headOp);
  if (baseRequestBody && !headRequestBody) {
    push('breaking', { kind: 'request_body_removed', severity: 'breaking', method, path, location: 'request', detail: `${method} ${path} request body was removed` });
  } else if (!baseRequestBody && headRequestBody) {
    push('non-breaking', { kind: 'request_body_added', severity: 'non-breaking', method, path, location: 'request', detail: `${method} ${path} request body was added` });
  } else if (baseRequestBody && headRequestBody) {
    diffSchema(baseSpec, headSpec, baseRequestBody, headRequestBody, { method, path, location: 'request', label: `${method} ${path} request` }, push);
  }

  const baseResponses = isObject(baseOp.responses) ? baseOp.responses : {};
  const headResponses = isObject(headOp.responses) ? headOp.responses : {};
  for (const code of Object.keys(baseResponses)) {
    if (!(code in headResponses)) {
      if (code === 'default' || /^2\d\d$/.test(code)) {
        push('breaking', { kind: 'response_removed', severity: 'breaking', method, path, status: code, location: 'response', detail: `${method} ${path} response ${code} was removed` });
      }
      continue;
    }
    const baseSchema = schemaFromResponse(baseSpec, baseResponses[code]);
    const headSchema = schemaFromResponse(headSpec, headResponses[code]);
    if (baseSchema && headSchema) {
      diffSchema(baseSpec, headSpec, baseSchema, headSchema, { method, path, status: code, location: 'response', label: `${method} ${path} ${code}` }, push);
    }
  }
  for (const code of Object.keys(headResponses)) {
    if (!(code in baseResponses)) {
      push('non-breaking', { kind: 'response_added', severity: 'non-breaking', method, path, status: code, location: 'response', detail: `${method} ${path} response ${code} was added` });
    }
  }
}

function diffSpecs(baseSpec, headSpec) {
  const breaking = [];
  const nonBreaking = [];
  const push = (severity, change) => (severity === 'breaking' ? breaking : nonBreaking).push(change);

  const basePaths = normalizedPaths(baseSpec);
  const headPaths = normalizedPaths(headSpec);

  for (const path of Object.keys(basePaths)) {
    if (!(path in headPaths)) {
      push('breaking', { kind: 'path_removed', severity: 'breaking', path, detail: `Path ${path} was removed` });
      continue;
    }
    const baseItem = deref(baseSpec, basePaths[path]);
    const headItem = deref(headSpec, headPaths[path]);
    for (const method of HTTP_METHODS) {
      const baseOp = baseItem && baseItem[method];
      const headOp = headItem && headItem[method];
      const verb = method.toUpperCase();
      if (baseOp && !headOp) {
        push('breaking', { kind: 'method_removed', severity: 'breaking', method: verb, path, detail: `${verb} ${path} was removed` });
      } else if (!baseOp && headOp) {
        push('non-breaking', { kind: 'method_added', severity: 'non-breaking', method: verb, path, detail: `${verb} ${path} was added` });
      } else if (baseOp && headOp) {
        diffOperation(baseSpec, headSpec, deref(baseSpec, baseOp), deref(headSpec, headOp), verb, path, push);
      }
    }
  }

  for (const path of Object.keys(headPaths)) {
    if (path in basePaths) continue;
    const headItem = deref(headSpec, headPaths[path]);
    for (const method of methodEntries(headItem)) {
      const verb = method[0].toUpperCase();
      push('non-breaking', { kind: 'path_added', severity: 'non-breaking', method: verb, path, detail: `${verb} ${path} was added` });
    }
  }

  return { hasBreaking: breaking.length > 0, breaking, nonBreaking, changes: [...breaking, ...nonBreaking] };
}

// ------------------------------------------------------------------ hashing

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashSpec(spec) {
  return crypto.createHash('sha256').update(stableStringify(spec)).digest('hex');
}

module.exports = {
  HTTP_METHODS,
  parseSpec,
  validateSpec,
  resolvePointer,
  deref,
  derefSchema,
  normalizePath,
  normalizeMethod,
  normalizeStatusCode,
  generateRequests,
  collectOperations,
  findOperation,
  getResponseSchema,
  requestSchemaOf,
  validateSchema,
  validateResponse,
  evaluateContractAssertion,
  diffSpecs,
  hashSpec,
  stableStringify,
};
