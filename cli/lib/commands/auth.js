'use strict';

const { UsageError, ApiError } = require('../errors');
const { loadConfig, saveConfig, tokenPrefix, resolveBaseUrl } = require('../config');
const { makeClient } = require('../client');
const { firstOption } = require('../parser');
const { promptText, promptSecret } = require('../prompt');

const HELP = `Usage: apihub login [--base-url <url>] [--token <token>]

Store API Hub credentials (base URL + personal API token) so commands run
without repeating them. Prompts interactively for anything not provided via
flags or the APIHUB_BASE_URL / APIHUB_TOKEN environment variables.

Credentials are validated live against GET /api/auth/me (falling back to
GET /api/profile) and then saved to ~/.config/apihub/config.json (0600).

  apihub logout                 remove the stored token
  apihub whoami                 show the authenticated user + token prefix
`;

function resolveLoginInputs(ctx) {
  const config = loadConfig();
  const flagUrl = firstOption(ctx.options, 'base-url');
  const flagToken = firstOption(ctx.options, 'token');
  const envUrl = process.env.APIHUB_BASE_URL;
  const envToken = process.env.APIHUB_TOKEN;

  let baseUrl = resolveBaseUrl({ flag: flagUrl, env: 'APIHUB_BASE_URL', config });
  let token = flagToken || envToken;

  const interactive = Boolean(process.stdin.isTTY);
  if (interactive) {
    if (!flagUrl && !envUrl) {
      const answered = awaitQuestion(baseUrl);
      if (answered) baseUrl = answered;
    }
    if (!flagToken && !envToken) {
      token = awaitSecret('Personal API token:');
    }
  } else if (!token) {
    throw new UsageError(
      'No token available. Pass --token <token> or set APIHUB_TOKEN, or run interactively.'
    );
  }
  return { baseUrl, token, config };
}

function awaitQuestion(defaultValue) {
  return promptText('API Hub base URL', defaultValue);
}

function awaitSecret(question) {
  return promptSecret(question);
}

async function loginCommand(ctx, io) {
  const { baseUrl, token, config } = await resolveLoginInputs(ctx);
  if (!token) throw new UsageError('A personal API token is required to log in.');

  const client = makeClient({ baseUrl, token });
  const user = await identifyForLogin(client);
  if (!user) {
    throw new ApiError(
      401,
      'The API did not accept this token. Confirm the token is active, that this API Hub backend accepts personal API tokens (Authorization: Bearer) on /api/auth/me or /api/profile, and that --base-url points at the right server.'
    );
  }

  const nextConfig = {
    baseUrl,
    token,
    defaultWorkspaceId: config.defaultWorkspaceId,
  };
  const file = saveConfig(nextConfig);

  io.out(`Logged in as ${user.name}`);
  if (user.email) io.out(`  email:    ${user.email}`);
  if (user.username) io.out(`  username: @${user.username}`);
  io.out(`  token:    ${tokenPrefix(token)}…`);
  io.out(`  server:   ${baseUrl}`);
  io.out(`  config:   ${file}`);
  return 0;
}

async function identifyForLogin(client) {
  try {
    const me = await client.get('/api/auth/me');
    const u = me.body && me.body.user;
    if (u && (u.email || u.name || u.username)) {
      return { email: u.email, name: u.name || u.username || u.email, username: u.username };
    }
  } catch (err) {
    if (!err || err.status !== 401) throw err;
  }
  try {
    const profile = await client.get('/api/profile');
    const u = profile.body && profile.body.user;
    if (u && (u.email || u.name || u.username)) {
      return { email: u.email, name: u.name || u.username || u.email, username: u.username };
    }
  } catch (err) {
    if (!err || err.status !== 401) throw err;
  }
  return null;
}

async function logoutCommand(ctx, io) {
  const config = loadConfig();
  config.token = undefined;
  saveConfig(config);
  io.out('Logged out. The stored token was removed from the local config.');
  return 0;
}

async function whoamiCommand(ctx, io) {
  const { loadConfig: load } = require('../config');
  const { makeClient: make } = require('../client');
  const { buildSession } = require('../session');
  const session = buildSession(ctx);
  const client = make({ baseUrl: session.baseUrl, token: session.token });

  let user = null;
  try {
    const me = await client.get('/api/auth/me');
    const u = me.body && me.body.user;
    if (u && u.email) user = u;
  } catch (err) {
    if (!err || err.status !== 401) throw err;
  }
  if (!user) {
    try {
      const profile = await client.get('/api/profile');
      const u = profile.body && profile.body.user;
      if (u && u.email) user = u;
    } catch (err) {
      if (!err || err.status !== 401) throw err;
    }
  }
  const cfg = load();
  io.out('Authenticated to API Hub');
  io.out(`  server:  ${session.baseUrl}`);
  io.out(`  token:   ${tokenPrefix(session.token)}…`);
  if (user) {
    io.out(`  user:    ${user.name || user.email}`);
    io.out(`  email:   ${user.email}`);
    if (user.username) io.out(`  username: @${user.username}`);
  } else {
    io.out('  user:    (could not resolve from server)');
  }
  return 0;
}

module.exports = { loginCommand, logoutCommand, whoamiCommand, HELP, resolveLoginInputs };
