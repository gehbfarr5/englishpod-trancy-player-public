#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../flutter_app"
test -s build/native-fixture.json
mkdir -p "$NATIVE_REPORT_DIR"
set +e
python3 - <<'PY' 2>&1 | tee "$NATIVE_REPORT_DIR/flutter.log"
import os
import signal
import subprocess
import sys

process = subprocess.Popen([
    'flutter', 'drive', '--no-pub', '--driver=test_driver/native_regression.dart',
    '--target=integration_test/native_regression_test.dart', '-d', os.environ['NATIVE_DEVICE'],
], start_new_session=True)
try:
    result = process.wait(timeout=1200)
except subprocess.TimeoutExpired:
    print('Native build/test command exceeded 20 minutes; no PASS claimed.', flush=True)
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
exit "$result"
