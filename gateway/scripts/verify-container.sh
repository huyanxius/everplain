#!/usr/bin/env bash
# Real built-image startup. Synthetic configuration, no platform/provider network.
set -euo pipefail
image="${1:-}"
revision="${2:-}"
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ && "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$revision" ]] || exit 2
container=""
trap '[[ -z "$container" ]] || docker rm -f "$container" >/dev/null' EXIT
container="$(docker run -d --network none --read-only \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --tmpfs /data:rw,nosuid,size=16m,uid=10001,gid=10001,mode=0750 \
  -e EVERPLAIN_GATEWAY_DATABASE_PATH=/data/everplain-gateway.db \
  -e EVERPLAIN_GATEWAY_RELEASE_REVISION="$revision" \
  -e EVERPLAIN_GATEWAY_PILOT_ONLY=true \
  -e EVERPLAIN_GATEWAY_TELEGRAM_ALLOWED_SUBJECT_IDS='["77"]' \
  -e EVERPLAIN_GATEWAY_TELEGRAM_TOKEN=123:synthetic_only_token_for_offline_container \
  -e EVERPLAIN_GATEWAY_TELEGRAM_WEBHOOK_SECRET=synthetic_webhook_secret_32_characters \
  -e EVERPLAIN_GATEWAY_TELEGRAM_BACKEND_SECRET=synthetic_backend_secret_32_characters \
  "$image")"
for attempt in {1..30}; do
  if docker exec -e EXPECTED_REVISION="$revision" "$container" /app/.venv/bin/python -c '
import json,os,urllib.request
value=json.load(urllib.request.urlopen("http://127.0.0.1:8298/health",timeout=2))
assert value["status"] == "local-ready"
assert value["release_revision"] == os.environ["EXPECTED_REVISION"]
assert value["queues"] == {"inbox": {}, "outbox": {}}
' >/dev/null 2>&1; then
    echo 'Channel image startup verified; real platforms and providers were not exercised.'
    exit 0
  fi
  sleep 1
done
echo 'Channel image startup failed; no live network was used.' >&2
exit 1
