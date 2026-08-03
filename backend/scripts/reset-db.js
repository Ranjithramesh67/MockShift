'use strict';

// Truncate all application tables so the first signup bootstraps as ADMIN.
const { pool } = require('../src/api/db');

async function main() {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const tables = rows.map((r) => r.tablename).join(', ');
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  // eslint-disable-next-line no-console
  console.log('[reset] application tables truncated');
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[reset] failed:', err.message);
  process.exit(1);
});
