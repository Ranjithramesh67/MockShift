'use strict';

function buildFetchBody(req) {
  if (req.body === null || req.body === undefined) return undefined;
  if (typeof req.body === 'string') return req.body;
  if (typeof req.body === 'object') {
    if (!req.headers['content-type']) {
      req.headers['content-type'] = 'application/json';
    }
    return JSON.stringify(req.body);
  }
  return String(req.body);
}

class NodeHttpExecutor {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async execute(req, { timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const body = buildFetchBody(req);
      const res = await this.fetchImpl(req.url, {
        method: req.method,
        headers: req.headers,
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      const responseHeaders = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: text,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { NodeHttpExecutor };
