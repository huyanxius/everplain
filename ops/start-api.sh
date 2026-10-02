#!/bin/sh
set -eu
umask 077
python /app/ops/preflight.py
if [ "${EVERPLAIN_MIGRATIONS_MANAGED:-0}" != "1" ]; then
    alembic upgrade head
fi
exec uvicorn qunxue_api.main:app --host 0.0.0.0 --port 8297 --workers 1 --no-access-log
