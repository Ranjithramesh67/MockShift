#!/usr/bin/env bash
# Test runner: applies the migration, seeds fixtures, and executes every
# *.sql file in db/tests. Fails fast on the first failing assertion.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PGHOST=127.0.0.1
export PGPORT=5432
export PGDATABASE=apihub
export PGUSER=postgres
export PGPASSWORD=postgres

echo "== Resetting app schema (dev/test database only)"
psql -q -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS app CASCADE" \
  -c "DROP SCHEMA public CASCADE" \
  -c "CREATE SCHEMA public"

echo "== Applying migrations: db/migrations/*.sql"
for m in "$ROOT"/db/migrations/*.sql; do
  echo "   - $(basename "$m")"
  psql -q -v ON_ERROR_STOP=1 -f "$m"
done

echo "== Seeding: db/seed.sql"
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/seed.sql"

for t in "$ROOT"/db/tests/*.sql; do
  echo
  echo "== Running: $(basename "$t")"
  psql -v ON_ERROR_STOP=1 -f "$t"
done

echo
echo "== All test suites passed =="
