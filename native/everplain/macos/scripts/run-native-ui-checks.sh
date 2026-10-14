#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'Native visual tests require macOS.' >&2; exit 2; }
export EVERPLAIN_RUN_NATIVE_UI_TESTS=1
export EVERPLAIN_UI_SNAPSHOT_DIR="$PWD/verification/ci-results/native-ui"
mkdir -p "$EVERPLAIN_UI_SNAPSHOT_DIR"
python3 - <<'PY'
import subprocess,sys
try:
    result=subprocess.run(['swift','test','--filter','NativeHomeVisualTests'],timeout=180)
    sys.exit(result.returncode)
except subprocess.TimeoutExpired:
    print('Native UI runner did not finish within 180 seconds.',file=sys.stderr)
    sys.exit(124)
PY
