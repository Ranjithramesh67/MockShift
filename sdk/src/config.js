'use strict';

const { ApiHubConfigError } = require('./errors');

const DEFAULTS = {
  baseUrl: 'http://localhost:3001',
  source: 'express',
  autoSync: true,
  timeoutMs: 5000,
  prune: false,
  include: [],
  exclude: [],
  onError: null,
};

function first(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function createConfig(options = {}, env = process.env) {
  const apiKey = first(options.apiKey, env.APIHUB_API_KEY, env.APIHUB_PROJECT_KEY, env.APIHUB_WORKSPACE_KEY);
  if (!apiKey) {
    throw new ApiHubConfigError(
      'API key is required — pass { apiKey } or set APIHUB_API_KEY / APIHUB_PROJECT_KEY / APIHUB_WORKSPACE_KEY.'
    );
  }
  const baseUrl = String(first(options.baseUrl, env.APIHUB_BASE_URL, DEFAULTS.baseUrl)).replace(/\/+$/, '');
  const timeoutMs = Number(first(options.timeoutMs, DEFAULTS.timeoutMs));
  return {
    ...DEFAULTS,
    ...options,
    apiKey: String(apiKey),
    baseUrl,
    project: first(options.project, env.APIHUB_PROJECT) || null,
    workspace: first(options.workspace, env.APIHUB_WORKSPACE) || null,
    collection: first(options.collection, env.APIHUB_COLLECTION) || null,
    targetBaseUrl: String(first(options.targetBaseUrl, env.APIHUB_TARGET_BASE_URL, '')).replace(/\/+$/, ''),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULTS.timeoutMs,
    include: Array.isArray(options.include) ? options.include : [],
    exclude: Array.isArray(options.exclude) ? options.exclude : [],
  };
}

module.exports = { createConfig, DEFAULTS };
