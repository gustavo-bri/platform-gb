#!/usr/bin/env bash
# Levanta un Postgres temporal, aplica el stub de Supabase + schema.sql y ejecuta las pruebas.
set -euo pipefail
cd "$(dirname "$0")"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -r postgres
  chown -R postgres "$DATA"
  RUN_AS="runuser -u postgres --"
fi
cleanup() { $RUN_AS "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
$RUN_AS "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
$RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=''" -w start >/dev/null
PSQL="psql -h /tmp -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f 00_supabase_stub.sql
$PSQL -f ../schema.sql
$PSQL -t -A -f 10_tests.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: //' | grep -vE '^\s*$|^(SET|RESET|INSERT|CREATE|GRANT|SELECT|UPDATE|DROP)( |$)'
