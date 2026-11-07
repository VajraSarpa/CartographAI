#!/usr/bin/env bash
# Apply migrations to a throwaway Postgres and run the RLS isolation tests.
# Usage: pnpm test:rls   (needs docker or podman)
set -euo pipefail
ENGINE=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo docker || echo podman)
NAME=cartograph-rls-$$
$ENGINE run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=test -p 54330:5432 docker.io/library/postgres:17-alpine >/dev/null
trap '$ENGINE stop "$NAME" >/dev/null' EXIT
export PGPASSWORD=test
for _ in $(seq 1 30); do pg_isready -h localhost -p 54330 -q && break; sleep 1; done
sleep 1
P="psql -h localhost -p 54330 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database carto"
$P -d carto -f supabase/tests/supabase-shim.sql
for f in supabase/migrations/*.sql; do $P -d carto -f "$f"; done
$P -d carto -f supabase/tests/rls.test.sql 2>&1 | sed 's/^psql:[^ ]* //' | grep -E "ok|FAIL|ERROR"
