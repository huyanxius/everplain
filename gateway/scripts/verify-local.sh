#!/usr/bin/env bash
# Synthetic local endpoints; never registers a bot or sends a real platform message.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
for executable in backend/.venv/bin/python gateway/.venv/bin/python; do
  if [[ ! -x "$executable" ]]; then
    echo "Missing $executable. Run uv sync --frozen in backend and gateway first." >&2
    exit 1
  fi
done
gateway/.venv/bin/ruff check gateway
backend/.venv/bin/ruff check backend/src/qunxue_api/application/channel_gateway.py \
  backend/src/qunxue_api/modules/channel_gateway \
  backend/src/qunxue_api/api/contracts/channel_gateway.py \
  backend/src/qunxue_api/api/routes/channel_gateway.py \
  backend/src/qunxue_api/adapters/sqlite/channel_gateway.py \
  backend/tests/test_channel_gateway.py backend/tests/test_channel_gateway_migration.py
(
  cd backend
  .venv/bin/pytest tests/test_channel_gateway.py tests/test_channel_gateway_migration.py \
    tests/test_architecture.py
)
gateway/.venv/bin/pytest gateway/tests
gateway/.venv/bin/pytest gateway/integration/test_http_contract.py -vv
