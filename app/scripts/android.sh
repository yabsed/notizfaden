#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$NOTIZFADEN_ROOT"
export VITE_API_URL="${1:-${VITE_API_URL:-}}"
export VITE_PUBLIC_URL="${2:-${VITE_PUBLIC_URL:-$VITE_API_URL}}"
export NOTIZFADEN_ANDROID_ASSETS=dist-android
case "$VITE_API_URL" in http://*) export NOTIZFADEN_ANDROID_DEV=1 ;; *) export NOTIZFADEN_ANDROID_DEV=0 ;; esac
npm run check
cd client
npx vite build --outDir dist-android
npx cap sync android
if [ -x "$NOTIZFADEN_ROOT/.data/jdk21/bin/javac" ]; then export JAVA_HOME="$NOTIZFADEN_ROOT/.data/jdk21"; fi
cd android
./gradlew :app:assembleDebug --console=plain
