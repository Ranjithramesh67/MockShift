'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'apihub',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  max: 10,
});

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
        process.env.VAULT_KEY || 'dev-vault-key-do-not-use-in-prod',
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
