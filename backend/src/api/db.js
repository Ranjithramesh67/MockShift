'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Classic PG* connection vars already present in the environment mean the
// caller wants a local/plain Postgres connection (tests set PGDATABASE, psql
// tooling sets PGHOST/...) — in that case an optional .env DATABASE_URL must
// not hijack the pool.
const PG_VARS = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
const hasExplicitPgVars = PG_VARS.some((k) => process.env[k] !== undefined);

// Vault key used for pgcrypto secret encryption/decryption. Never fall back to
// the well-known dev key on a production deployment: that would encrypt secrets
// under a guessable key. With an empty key app.vault_key() returns NULL, so
// app.try_decrypt() yields NULL (secrets fail closed) instead of leaking.
const VAULT_KEY =
  process.env.VAULT_KEY || (process.env.NODE_ENV === 'production' ? '' : 'dev-vault-key-do-not-use-in-prod');
if (process.env.NODE_ENV === 'production' && !process.env.VAULT_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[db] VAULT_KEY is not set in production; stored secrets will resolve to NULL and new secret writes will fail. Set VAULT_KEY to the deployment vault key.'
  );
}

// Optional local .env (gitignored) so developers can point the backend at a
// managed database (e.g. Aiven) without committing credentials. Loaded before
// the pool is built; never overrides already-set process env vars.
const ENV_FILE = path.join(__dirname, '..', '..', '.env');
if (!hasExplicitPgVars && fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// SSL trust store for managed databases (Aiven). When DATABASE_URL carries
// `sslmode=require`, pg only verifies the certificate chain if a CA file is
// supplied — use the checked-in db/ca.pem when present.
const CA_FILE = process.env.PGSSLROOTCERT || path.join(__dirname, '..', '..', '..', 'db', 'ca.pem');

function sslConfig() {
  if (!process.env.PGSSLMODE || process.env.PGSSLMODE === 'disable') return undefined;
  if (fs.existsSync(CA_FILE)) return { ca: fs.readFileSync(CA_FILE, 'utf8') };
  return { rejectUnauthorized: false };
}

let pool;
if (process.env.DATABASE_URL && !hasExplicitPgVars) {
  // Strip `sslmode` from the URL: pg treats sslmode=require/verify-ca as
  // aliases for verify-full and would otherwise ignore our CA trust store.
  const cleanUrl = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*(&|$)/, (m, pre, post) =>
    post ? pre : ''
  );
  pool = new Pool({
    connectionString: cleanUrl,
    ssl: sslConfig(),
    max: 10,
  });
} else {
  pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'apihub',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    ssl: sslConfig(),
    max: 10,
  });
}

/**
 * Run a query, optionally scoped to a user so that app.* RLS helpers and the
 * variable resolver see the correct session context.
 */
async function query(text, params = [], options = {}) {
  const client = await pool.connect();
  try {
    if (options.userId) {
      // set_config(..., true) only persists within a transaction; without one
      // the session vars revert before the actual query runs, which made
      // encrypted (secret) variables decrypt to NULL in the resolver.
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', options.userId]);
      await client.query('SELECT set_config($1, $2, true)', [
        'app.vault_key',
        VAULT_KEY,
      ]);
    }
    const result = await client.query(text, params);
    if (options.userId) await client.query('COMMIT');
    return result;
  } catch (err) {
    if (options.userId) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
