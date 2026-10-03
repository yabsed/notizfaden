#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$NOTIZFADEN_ROOT"
export PGHOST=127.0.0.1 PGPORT=55432
if [ "$(psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='notizfaden_social_test'")" != 1 ]; then
  createdb notizfaden_social_test
fi
export DATABASE_URL='host=127.0.0.1 port=55432 dbname=notizfaden_social_test'
export PORT=8082 ALLOWED_ORIGINS='http://localhost:5175,http://localhost:5176,https://localhost'
export NOTIZFADEN_ADMIN_USERNAME=social_admin NOTIZFADEN_API_PROXY=http://127.0.0.1:8082
# Build once so offline browser tests exercise this same client revision.
npm run build
(cd server && cabal build)
test_api_binary=$(cd server && cabal list-bin notizfaden-server)
test_pids=()
trap 'kill "${test_pids[@]}" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
"$test_api_binary" & test_pids+=("$!")
node node_modules/vite/bin/vite.js client --host 127.0.0.1 --port 5175 --strictPort & test_pids+=("$!")
node node_modules/vite/bin/vite.js preview client --host 127.0.0.1 --port 5176 --strictPort & test_pids+=("$!")
wait -n "${test_pids[@]}"
