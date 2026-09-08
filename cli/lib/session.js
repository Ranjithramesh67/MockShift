'use strict';

const { UsageError } = require('./errors');
const { makeClient } = require('./client');
const {
  loadConfig,
  resolveBaseUrl,
  resolveToken,
  tokenPrefix,
} = require('./config');
const { firstOption, hasFlag } = require('./parser');

function parseKeyValuePairs(values, optionName) {
  const out = {};
  for (const raw of values || []) {
    const eq = String(raw).indexOf('=');
    if (eq <= 0) {
      throw new UsageError(`Invalid ${optionName} "${raw}" — expected key=value`);
    }
    const key = String(raw).slice(0, eq).trim();
    const value = String(raw).slice(eq + 1);
    if (!key) throw new UsageError(`Invalid ${optionName} "${raw}" — empty key`);
    out[key] = value;
  }
  return out;
}

function buildSession(ctx, { needToken = true } = {}) {
  const flagUrl = firstOption(ctx.options, 'base-url');
  const flagToken = firstOption(ctx.options, 'token');
  const config = loadConfig();
  const baseUrl = resolveBaseUrl({ flag: flagUrl, env: 'APIHUB_BASE_URL', config });
  const token = resolveToken({ flag: flagToken, env: 'APIHUB_TOKEN', config });

  if (needToken && !token) {
    throw new UsageError(
      'Not logged in. Run "apihub login", set APIHUB_TOKEN, or pass --token <token>.'
    );
  }
  return { baseUrl, token, config };
}

function defaultWorkspaceId(ctx, config) {
  const flag = firstOption(ctx.options, 'workspace');
  if (flag) return flag;
  if (config && config.defaultWorkspaceId) return config.defaultWorkspaceId;
  return undefined;
}

function makeApiClient(session) {
  return makeClient({ baseUrl: session.baseUrl, token: session.token });
}

async function identifyUser(client) {
  let meRes;
  try {
    meRes = await client.get('/api/auth/me');
    const u = meRes.body && meRes.body.user;
    if (u && (u.email || u.name || u.username)) {
      return {
        id: u.id || null,
        email: u.email || null,
        username: u.username || null,
        name: u.name || u.username || u.email || 'unknown',
      };
    }
  } catch (err) {
    if (err && err.status !== 401) throw err;
  }
  try {
    const profileRes = await client.get('/api/profile');
    const u = profileRes.body && profileRes.body.user;
    if (u && (u.email || u.name || u.username)) {
      return {
        id: u.id || null,
        email: u.email || null,
        username: u.username || null,
        name: u.name || u.username || u.email || 'unknown',
      };
    }
  } catch (err) {
    if (err && err.status !== 401) throw err;
  }
  return null;
}

module.exports = {
  parseKeyValuePairs,
  buildSession,
  defaultWorkspaceId,
  makeApiClient,
  identifyUser,
  tokenPrefix,
  hasFlag,
};
