'use strict';

const http = require('node:http');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DBNAME = process.env.INTEGRATION_PGDATABASE || 'apihub';
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || process.env.PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: DBNAME,
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psql(sql) {
  return execFileSync(
    'psql',
    ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DBNAME, '-c', sql],
    { env: PGENV, stdio: 'pipe', encoding: 'utf8' }
  );
}

async function startApp() {
  psql('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  const migrationsDir = path.join(ROOT, 'db', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    execFileSync(
      'psql',
      ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DBNAME, '-f', path.join(migrationsDir, file)],
      { env: PGENV, stdio: 'pipe' }
    );
  }
  psql('UPDATE portal_settings SET restrictions_enforced = false;');

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = DBNAME;
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../../src/api/server');
  const server = await new Promise((resolve) => {
    const app = createApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    close: async () => {
      await new Promise((r) => server.close(r));
      await require('../../src/api/db').pool.end();
    },
  };
}

function makeClient(base) {
  let cookie = '';
  async function api(method, url, body, extraHeaders) {
    const headers = { ...(extraHeaders || {}) };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /ah\.session=([^;]+)/.exec(setCookie);
      if (m) cookie = `ah.session=${m[1]}`;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  return { api, get cookie() { return cookie; } };
}

async function signupAndLogin(base, email, password, name) {
  const client = makeClient(base);
  const res = await client.api('POST', '/api/auth/signup', { email, password, name });
  if (res.status !== 201) {
    throw new Error(`signup failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`);
  }
  const user = res.json.user.user || res.json.user;
  return { client, cookie: client.cookie, user, id: user.id };
}

module.exports = { ROOT, DBNAME, psql, startApp, makeClient, signupAndLogin };
