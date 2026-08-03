'use strict';

const { sanitizeRequest } = require('./sanitizer');

function buildRequestObject(row) {
  const headers = {};
  for (const h of row.headers || []) {
    headers[h.key] = h.value;
  }
  const query = {};
  for (const q of row.queryParams || []) {
    query[q.key] = q.value;
  }
  let body = null;
  if (row.bodyType === 'JSON' && row.bodyJson !== undefined && row.bodyJson !== null) {
    body = JSON.parse(JSON.stringify(row.bodyJson));
  } else if (row.bodyType === 'RAW_TEXT') {
    body = row.bodyText !== undefined ? String(row.bodyText) : '';
  } else if (row.bodyType === 'FORM_URLENCODED') {
    body = {};
    for (const f of row.bodyForm || []) {
      body[f.key] = f.value;
    }
  }
  return { method: row.method, url: row.url, headers, query, body, requestId: row.id };
}

function resolvePath(vars, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), vars);
}

function substituteTemplates(text, vars) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (match, key) => {
    const value = resolvePath(vars, key);
    return value === undefined ? match : String(value);
  });
}

function applyTemplates(req, vars) {
  req.url = substituteTemplates(req.url, vars);
  for (const key of Object.keys(req.headers)) {
    req.headers[key] = substituteTemplates(req.headers[key], vars);
  }
  for (const key of Object.keys(req.query)) {
    req.query[key] = substituteTemplates(req.query[key], vars);
  }
  if (typeof req.body === 'string') {
    req.body = substituteTemplates(req.body, vars);
  } else if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      req.body[key] = substituteTemplates(req.body[key], vars);
    }
  }
  return req;
}

function diffVars(next, prev) {
  const out = {};
  for (const [key, value] of Object.entries(next || {})) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      if (!(key in prev) || prev[key] !== value) {
        out[key] = value;
      }
    }
  }
  return out;
}

class RequestDispatcher {
  constructor({
    sandbox,
    variableStore,
    requestRepository,
    runRepository,
    httpExecutor,
    options = {},
  }) {
    this.sandbox = sandbox;
    this.variableStore = variableStore;
    this.requestRepository = requestRepository;
    this.runRepository = runRepository;
    this.httpExecutor = httpExecutor;
    this.options = {
      maxBodyBytes: options.maxBodyBytes || 1000000,
      httpTimeoutMs: options.httpTimeoutMs || 30000,
    };
  }

  async execute({
    requestId,
    environmentId,
    actorId = null,
    trigger = 'MANUAL',
    vars: providedVars = null,
    persistVars = true,
    formula: formulaOverride = null,
  }) {
    const requestRow = await this.requestRepository.findById(requestId);
    if (!requestRow) {
      throw new Error(`Request not found: ${requestId}`);
    }

    const varsBefore = providedVars !== null ? { ...providedVars } : await this.variableStore.resolve({ requestId, environmentId });
    let vars = varsBefore;
    const req = buildRequestObject(requestRow);
    const formula = formulaOverride !== null ? formulaOverride : requestRow.formula;

    if (formula) {
      const outcome = await this.sandbox.run({ source: formula, req, vars });
      if (outcome.req !== undefined) {
        Object.assign(req, outcome.req);
      }
      if (outcome.vars !== undefined) {
        vars = outcome.vars;
      }
    }

    applyTemplates(req, vars);
    sanitizeRequest(req, { maxBodyBytes: this.options.maxBodyBytes });

    const startedAt = new Date();
    const response = await this.httpExecutor.execute(req, {
      timeoutMs: this.options.httpTimeoutMs,
    });
    const finishedAt = new Date();

    if (persistVars) {
      const varWrites = diffVars(vars, varsBefore);
      if (Object.keys(varWrites).length > 0) {
        await this.variableStore.setMany({ requestId, environmentId, values: varWrites });
      }
    }

    return this.runRepository.create({
      requestId,
      environmentId,
      actorId,
      trigger,
      status: response.status >= 200 && response.status < 400 ? 'SUCCESS' : 'FAILED',
      requestSnapshot: req,
      responseSnapshot: response,
      startedAt,
      finishedAt,
      vars,
    });
  }
}

module.exports = {
  RequestDispatcher,
  buildRequestObject,
  applyTemplates,
  diffVars,
};
