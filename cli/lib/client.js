'use strict';

const { ApiError } = require('./errors');

function makeClient({ baseUrl, token, timeoutMs = 30000, fetchImpl = null }) {
  const fetchFn = fetchImpl || ((url, init) => fetch(url, init));

  async function request(method, path, { query = null, body = undefined, headers = {} } = {}) {
    let url = `${baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) qs.set(key, String(value));
      }
      const rendered = qs.toString();
      if (rendered) url += url.includes('?') ? `&${rendered}` : `?${rendered}`;
    }

    const requestHeaders = { ...headers };
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    let requestBody;
    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetchFn(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err && err.name === 'TimeoutError') {
        throw new ApiError(0, `Request timed out after ${timeoutMs} ms: ${method} ${path}`);
      }
      throw new ApiError(0, `Request failed: ${err && err.message ? err.message : err} (${method} ${path})`);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message =
        payload && typeof payload.error === 'string'
          ? payload.error
          : payload && typeof payload.message === 'string'
            ? payload.message
            : `HTTP ${response.status} ${response.statusText}`;
      throw new ApiError(response.status, message, payload);
    }
    return { status: response.status, body: payload, text };
  }

  function get(path, options) {
    return request('GET', path, options);
  }
  function post(path, options) {
    return request('POST', path, options);
  }
  function put(path, options) {
    return request('PUT', path, options);
  }
  function patch(path, options) {
    return request('PATCH', path, options);
  }
  function del(path, options) {
    return request('DELETE', path, options);
  }

  return { request, get, post, put, patch, del };
}

module.exports = { makeClient };
