#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DMG_PATH="${HOME}/Downloads/devecostudio-mac-arm-26.0.1.290/deveco-studio-26.0.1.290-aarch64.dmg"
DEVECO_APP="/Volumes/DevEco-Studio/DevEco-Studio.app"
if [ -d "/Applications/DevEco-Studio.app" ]; then
  DEVECO_APP="/Applications/DevEco-Studio.app"
elif [ ! -d "${DEVECO_APP}" ] && [ -f "${DMG_PATH}" ]; then
  echo "Mounting DevEco Studio DMG..."
  hdiutil attach "${DMG_PATH}" -nobrowse -readonly >/dev/null
fi

if [ ! -d "${DEVECO_APP}/Contents" ]; then
  echo "ERROR: DevEco-Studio.app not found." >&2
  exit 1
fi

export DEVECO_HOME="${DEVECO_APP}/Contents"
export PATH="${DEVECO_HOME}/tools/node/bin:${DEVECO_HOME}/tools/ohpm/bin:${DEVECO_HOME}/tools/hvigor/bin:${DEVECO_HOME}/jbr/Contents/Home/bin:${PATH}"
export JAVA_HOME="${DEVECO_HOME}/jbr/Contents/Home"
export DEVECO_SDK_HOME="${DEVECO_HOME}/sdk"

cd "${APP_DIR}"
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon

UNSIGNED_HAP="${APP_DIR}/entry/build/default/outputs/default/entry-default-unsigned.hap"
if [ ! -f "${UNSIGNED_HAP}" ]; then
  echo "ERROR: Built HAP not found at ${UNSIGNED_HAP}" >&2
  exit 1
fi

if [ "${SKIP_INSTALL:-0}" = "1" ]; then
  echo "SKIP_INSTALL=1 set. Built ${UNSIGNED_HAP}"
  exit 0
fi

INSTALL_LOG="$(mktemp)"
trap 'rm -f "${INSTALL_LOG}"' EXIT

/Users/jin/HarmonySign/install_hap.sh "${UNSIGNED_HAP}" | tee "${INSTALL_LOG}"

if ! grep -q "install bundle successfully\." "${INSTALL_LOG}"; then
  echo "ERROR: hdc install did not report 'install bundle successfully.'" >&2
  exit 1
fi

echo "SUCCESS: HAP built, signed, and installed."
