#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ]; then bash scripts/db.sh; fi
bash scripts/server.sh &
TEUM_SERVER_PID=$!
trap 'kill "$TEUM_SERVER_PID" 2>/dev/null || true' EXIT INT TERM
npm run dev
