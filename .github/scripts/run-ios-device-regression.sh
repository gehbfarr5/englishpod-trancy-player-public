#!/usr/bin/env bash
# Runs automated integration regression tests against a connected physical iPhone.
# Enforces strict sandbox isolation and bounds execution.
set -euo pipefail

cd "$(dirname "$0")/../../flutter_app"
test -s build/native-fixture.json

export NATIVE_REPORT_DIR="${NATIVE_REPORT_DIR:-$(pwd)/../native-evidence}"
mkdir -p "$NATIVE_REPORT_DIR"
log="$NATIVE_REPORT_DIR/flutter-device.log"
: > "$log"

if [ -z "${NATIVE_DEVICE:-}" ]; then
  echo "ERROR: NATIVE_DEVICE environment variable is not set." | tee -a "$log"
  exit 1
fi

echo "=== Running iOS Physical Device Regression on $NATIVE_DEVICE ===" | tee -a "$log"

set +e
python3 - <<'PY' 2>&1 | tee -a "$log"
import os
import signal
import subprocess
import sys

device_id = os.environ['NATIVE_DEVICE']
print(f"Targeting connected iOS device: {device_id}", flush=True)

# Run Flutter integration test with dedicated native regression driver
process = subprocess.Popen([
    'flutter', 'drive', '--no-pub',
    '--driver=test_driver/native_regression.dart',
    '--target=integration_test/native_regression_test.dart',
    '-d', device_id,
], start_new_session=True)

try:
    result = process.wait(timeout=1200) # 20 minute limit
except subprocess.TimeoutExpired:
    print('Device test command exceeded 20 minutes timeout; marking failed.', flush=True)
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    result = 124

sys.exit(result)
PY
result=${PIPESTATUS[0]}
set -e

printf '%s\n' "$result" > "$NATIVE_REPORT_DIR/exit-code.txt"
echo "=== iOS Physical Device Regression finished with exit code: $result ===" | tee -a "$log"
exit "$result"
