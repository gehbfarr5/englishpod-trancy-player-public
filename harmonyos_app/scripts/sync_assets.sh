#!/usr/bin/env bash
set -euo pipefail

# Syncs EnglishPod lesson JSONs, audio MP3s, and brand icons from flutter_app/assets
# into harmonyos_app/entry/src/main/resources/rawfile without duplicating 2.2 GB in git.
#
# Usage:
#   SYNC_SCOPE=smoke ./harmonyos_app/scripts/sync_assets.sh   # ~20 MB (lessons 0001..0003 + full index.json)
#   SYNC_SCOPE=full  ./harmonyos_app/scripts/sync_assets.sh   # Full 335 lessons + audio (~2.3 GB)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SRC_ASSETS="${REPO_ROOT}/flutter_app/assets"
DST_RAWFILE="${REPO_ROOT}/harmonyos_app/entry/src/main/resources/rawfile"
SCOPE="${SYNC_SCOPE:-full}"
MODE="${SYNC_MODE:-symlink}"

mkdir -p "${DST_RAWFILE}/branding"

rm -rf "${DST_RAWFILE}/lessons_safe" "${DST_RAWFILE}/audio"

if [ "${REBUILD_WEB:-0}" = "1" ] || [ ! -f "${DST_RAWFILE}/flutter_web/main.dart.js" ]; then
  python3 "${SCRIPT_DIR}/build_flutter_web.py"
fi

if [ "${SCOPE}" = "smoke" ]; then
  echo "Syncing SMOKE audio assets (lessons 0001..0003; all 335 lesson JSONs are inside flutter_web)..."
  mkdir -p "${DST_RAWFILE}/audio"
  for lid in 0001 0002 0003; do
    if [ -d "${SRC_ASSETS}/audio/${lid}" ]; then
      cp -R "${SRC_ASSETS}/audio/${lid}" "${DST_RAWFILE}/audio/${lid}"
    fi
  done
else
  echo "Syncing FULL audio assets (335 lessons)..."
  if [ "${MODE}" = "copy" ]; then
    cp -R "${SRC_ASSETS}/audio" "${DST_RAWFILE}/audio"
  else
    ln -s "${SRC_ASSETS}/audio" "${DST_RAWFILE}/audio"
  fi
fi

if [ -d "${SRC_ASSETS}/branding" ]; then
  cp -f "${SRC_ASSETS}/branding/"*.png "${DST_RAWFILE}/branding/" 2>/dev/null || true
fi

du -sh "${DST_RAWFILE}"
echo "Done (SYNC_SCOPE=${SCOPE})."
