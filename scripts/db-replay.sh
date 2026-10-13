#!/usr/bin/env bash
# Rebuilds the database from scratch on a plain Postgres (with PostGIS) exactly as Supabase would, replays EVERY migration in order,
# then runs the SQL tests. Used by CI (.github/workflows/ci.yml) and runnable by hand:
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/db-replay.sh
set -euo pipefail
DB="${DB_NAME:-scratch}"
psql -q -c "drop database if exists ${DB}" -c "create database ${DB}"
psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql
psql -q -d "${DB}" -c "alter database ${DB} set search_path = public, extensions"
for f in supabase/migrations/*.sql; do echo "migration: $f"; psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f "$f"; done
for t in supabase/tests/*.test.sql; do
  echo "test: $t"
  out=$(psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f "$t" 2>&1) || { echo "$out" | tail -20; echo "SQL test FAILED: $t"; exit 1; }
  echo "$out" | grep -E "PASSED" || { echo "$out" | tail -20; echo "SQL test did not report PASSED: $t"; exit 1; }
done
echo "database replay and SQL tests: OK"
