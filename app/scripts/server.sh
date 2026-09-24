#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$NOTIZFADEN_ROOT/server"
exec cabal run notizfaden-server
