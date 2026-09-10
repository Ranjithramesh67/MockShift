'use strict';

const { ApiHubError } = require('./errors');

function createClient(config) {
  const base = String(config.baseUrl || '').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` };

  async function sync(manifest) {
    let res;
    try {
      res = await fetch(`${base}/api/sdk/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(config.timeoutMs || 5000),
      });
    } catch (cause) {
      throw new ApiHubError(`apihub sync failed: ${cause.message}`, { cause });
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      throw new ApiHubError(`apihub sync failed: HTTP ${res.status}${body.error ? ` ${body.error}` : ''}`, {
        status: res.status,
        body,
      });
    }
    return body;
  }

  return { sync };
}

module.exports = { createClient };
