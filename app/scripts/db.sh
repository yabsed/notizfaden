#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
mkdir -p "$TEUM_ROOT/.data/pgsocket"
if [ ! -f "$TEUM_ROOT/.data/postgres/PG_VERSION" ]; then
  initdb -D "$TEUM_ROOT/.data/postgres" --auth-local=trust --auth-host=trust --encoding=UTF8 --no-locale
fi
if ! pg_ctl -D "$TEUM_ROOT/.data/postgres" status >/dev/null 2>&1; then
  pg_ctl -D "$TEUM_ROOT/.data/postgres" -l "$TEUM_ROOT/.data/postgres.log" -o "-h 127.0.0.1 -p 55432 -k $TEUM_ROOT/.data/pgsocket" start
fi
if ! psql -h 127.0.0.1 -p 55432 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='teum'" | grep -q 1; then
  createdb -h 127.0.0.1 -p 55432 teum
fi
