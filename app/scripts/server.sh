#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$TEUM_ROOT/server"
exec cabal run keep-sns-server
