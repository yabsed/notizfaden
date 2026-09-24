#!/usr/bin/env bash
# Optional user-local GHCup and development headers; system installs work too.
NOTIZFADEN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$HOME/.ghcup/env" ]; then source "$HOME/.ghcup/env"; fi
if [ -d "$HOME/.ghcup/prereqs/usr/lib64" ]; then
  export LIBRARY_PATH="$HOME/.ghcup/prereqs/usr/lib64${LIBRARY_PATH:+:$LIBRARY_PATH}"
  export C_INCLUDE_PATH="$HOME/.ghcup/prereqs/usr/include${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
fi
if [ -d "$NOTIZFADEN_ROOT/.data/native/usr/lib64" ]; then
  export LIBRARY_PATH="$NOTIZFADEN_ROOT/.data/native/usr/lib64${LIBRARY_PATH:+:$LIBRARY_PATH}"
  export C_INCLUDE_PATH="$NOTIZFADEN_ROOT/.data/native/usr/include${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
  export PKG_CONFIG_PATH="$NOTIZFADEN_ROOT/.data/native/usr/lib64/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
fi
