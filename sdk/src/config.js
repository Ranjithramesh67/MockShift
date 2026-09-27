'use strict';

const { MockshiftConfigError } = require('./errors');
const { loadConfigFile, findConfigPath } = require('./configfile');

const DEFAULTS = {
  baseUrl: 'http://localhost:3001',
  source: 'express',
  autoSync: true,
  timeoutMs: 5000,
  prune: false,
  include: [],
  exclude: [],
  pathRules: [],
  onError: null,
  capture: {
    enabled: true,
    requestBodies: true,
    responseBodies: true,
    maxEvents: 1000,
    maxBodyBytes: 100000,
  },
  assertions: {
    status: true,
    json: true,
    responseTime: false,
    maxResponseTimeMs: null,
    maxTopLevelFields: 5,
  },
};

function first(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asBool(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'false' || value === '0') return false;
  return Boolean(value);
}

/**
 * Resolve an SDK configuration from (lowest → highest precedence):
 * the `mockshift.json` file, environment variables, explicit options.
 */
function createConfig(options = {}, env = process.env) {
  const fileConfig = options.config && typeof options.config === 'object'
    ? options.config
    : (options.file === false ? null : loadConfigFile(options.configFile, { env })) || {};

  const merged = { ...DEFAULTS, ...fileConfig, ...options };
  // Never leak internal __path into the public config, but keep it for debug.
  const configPath = fileConfig.__path || findConfigPath(options.configFile, process.cwd(), env) || null;

  const apiKey = first(
    options.apiKey,
    options.token,
    env.MOCKSHIFT_API_KEY,
    env.MOCKSHIFT_TOKEN,
    env.APIHUB_API_KEY,
    env.APIHUB_PROJECT_KEY,
    env.APIHUB_WORKSPACE_KEY,
    fileConfig.apiKey,
    fileConfig.token
  );
  if (!apiKey) {
    throw new MockshiftConfigError(
      'API key is required — add "token" to mockshift.json, pass { apiKey }, or set MOCKSHIFT_API_KEY / APIHUB_API_KEY.'
    );
  }

  const baseUrl = String(
    first(options.baseUrl, env.MOCKSHIFT_BASE_URL, env.APIHUB_BASE_URL, fileConfig.baseUrl, DEFAULTS.baseUrl)
  ).replace(/\/+$/, '');

  const timeoutMs = Number(first(options.timeoutMs, fileConfig.timeoutMs, DEFAULTS.timeoutMs));

  return {
    ...merged,
    configPath,
    apiKey: String(apiKey),
    baseUrl,
    project: first(options.project, env.MOCKSHIFT_PROJECT, env.APIHUB_PROJECT, fileConfig.project) || null,
    workspace: first(options.workspace, env.MOCKSHIFT_WORKSPACE, env.APIHUB_WORKSPACE, fileConfig.workspace) || null,
    collection: first(options.collection, env.MOCKSHIFT_COLLECTION, env.APIHUB_COLLECTION, fileConfig.collection) || null,
    targetBaseUrl: String(
      first(options.targetBaseUrl, env.MOCKSHIFT_TARGET_BASE_URL, env.APIHUB_TARGET_BASE_URL, fileConfig.targetBaseUrl, '')
    ).replace(/\/+$/, ''),
    source: first(options.source, fileConfig.source, DEFAULTS.source),
    autoSync: asBool(first(options.autoSync, fileConfig.autoSync), DEFAULTS.autoSync),
    prune: asBool(first(options.prune, fileConfig.prune), DEFAULTS.prune),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULTS.timeoutMs,
    include: Array.isArray(first(options.include, fileConfig.include)) ? first(options.include, fileConfig.include) : [],
    exclude: Array.isArray(first(options.exclude, fileConfig.exclude)) ? first(options.exclude, fileConfig.exclude) : [],
    pathRules: Array.isArray(first(options.pathRules, fileConfig.pathRules)) ? first(options.pathRules, fileConfig.pathRules) : [],
    capture: { ...DEFAULTS.capture, ...(fileConfig.capture || {}), ...(options.capture || {}) },
    assertions: { ...DEFAULTS.assertions, ...(fileConfig.assertions || {}), ...(options.assertions || {}) },
  };
}

module.exports = { createConfig, DEFAULTS };
