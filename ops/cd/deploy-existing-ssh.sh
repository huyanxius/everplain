#!/usr/bin/env bash
# Publish only this checked main run, using the existing account and SSH identity.
set -euo pipefail
umask 077
mode="${1:-all}"
[[ "$mode" == all || "$mode" == trial || "$mode" == upload || "$mode" == apply ]] || exit 2
for name in EVERPLAIN_DEPLOY_HOST EVERPLAIN_DEPLOY_USER EVERPLAIN_DEPLOY_PORT EVERPLAIN_SSH_HOST_KEY_FINGERPRINT EVERPLAIN_SSH_PRIVATE_KEY GITHUB_SHA GITHUB_RUN_ID GITHUB_RUN_ATTEMPT EXPECTED_SHA256; do
  [[ -n "${!name:-}" ]] || { echo "Missing required production setting: $name" >&2; exit 2; }
done
[[ "$EVERPLAIN_DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 2
[[ "$EVERPLAIN_DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || exit 2
[[ "$EVERPLAIN_DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] || exit 2
port=$((10#$EVERPLAIN_DEPLOY_PORT))
(( port > 0 && port < 65536 )) || exit 2
[[ "$EVERPLAIN_SSH_HOST_KEY_FINGERPRINT" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || exit 2
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || exit 2
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]] || exit 2
root="$(cd "$(dirname "$0")/../.." && pwd)"
archive="$root/dist/release/everplain.tar.gz"
python3 "$root/ops/cd/release_identity.py" verify "$archive" "$GITHUB_SHA" \
  "$EXPECTED_SHA256" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
private="$(mktemp -d)"
trap 'rm -rf "$private"' EXIT
# keyscan is discovery, not trust: verify against the previously approved fingerprint.
if ! ssh-keyscan -T 10 -p "$port" -t ed25519 "$EVERPLAIN_DEPLOY_HOST" > "$private/known_hosts" 2>/dev/null; then
  echo 'Host-key lookup failed; no SSH authentication attempted' >&2; exit 2;
fi
fingerprints="$(ssh-keygen -lf "$private/known_hosts" -E sha256 | awk '{print $2}' | sort -u)"
[[ "$fingerprints" == "$EVERPLAIN_SSH_HOST_KEY_FINGERPRINT" ]] || {
  echo 'Host-key verification failed; no SSH authentication attempted' >&2; exit 2;
}
printf '%s\n' "$EVERPLAIN_SSH_PRIVATE_KEY" > "$private/key"
unset EVERPLAIN_SSH_PRIVATE_KEY
opts=(-i "$private/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$private/known_hosts" -o GlobalKnownHostsFile=/dev/null
  -o ClearAllForwardings=yes -o ForwardAgent=no -o PermitLocalCommand=no -o RequestTTY=no
  -o LogLevel=ERROR -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
target="$EVERPLAIN_DEPLOY_USER@$EVERPLAIN_DEPLOY_HOST"
size="$(stat -c %s "$archive")"
state="$root/.everplain-upload"
if [[ "$mode" != apply ]]; then
# No running release may be duplicated; inspect only our prior temporary upload files.
ssh "${opts[@]}" -p "$port" "$target" "sudo -n python3 - find $size $EXPECTED_SHA256" \
  < "$root/ops/cd/upload-state.py" > "$private/uploads.json"
mapfile -t selected < <(python3 - "$archive" "$private/uploads.json" <<'PYSELECT'
import hashlib,json,sys
from pathlib import Path
source=Path(sys.argv[1])
for item in json.loads(Path(sys.argv[2]).read_text()):
    remaining=item["size"]
    digest=hashlib.sha256()
    with source.open("rb") as stream:
        while remaining:
            chunk=stream.read(min(1024*1024,remaining))
            if not chunk: break
            digest.update(chunk); remaining-=len(chunk)
    if remaining == 0 and digest.hexdigest() == item["sha256"]:
        print(item["directory"])
        print("true" if item["size"] == source.stat().st_size else "false")
        print(item["size"])
        print(item["sha256"])
        break
PYSELECT
)
upload="${selected[0]:-}"
complete="${selected[1]:-false}"
prefix_size="${selected[2]:-0}"
prefix_hash="${selected[3]:-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855}"
if [[ -z "$upload" ]]; then
  upload="$(ssh "${opts[@]}" -p "$port" "$target" 'mktemp -d /tmp/everplain-candidate.XXXXXXXX')"
fi
[[ "$upload" =~ ^/tmp/everplain-candidate\.[A-Za-z0-9]+$ ]] || exit 2
ssh "${opts[@]}" -p "$port" "$target" "sudo -n python3 - space $size $EXPECTED_SHA256 $upload" \
  < "$root/ops/cd/upload-state.py" > /dev/null
if [[ "$complete" != true ]]; then
  duration=1800
  [[ "$mode" != trial ]] || duration=120
  attempts=2
  [[ "$mode" != trial ]] || attempts=1
  # Resume only a bounded timeout of these exact bytes; integrity/SSH errors stop.
  for ((attempt=1; attempt<=attempts; attempt++)); do
    status=0
    python3 "$root/ops/cd/upload_parts.py" local "$archive" "$upload" "$private" \
      "$port" "$target" "$prefix_size" "$prefix_hash" "$duration" "${opts[@]}" || status=$?
    [[ "$status" == 3 && "$attempt" -lt "$attempts" ]] || break
    echo '{"upload_timeout_resume":true}'
  done
  if [[ "$status" == 3 && "$mode" == trial ]]; then
    echo '{"parallel_trial_finished":true,"upload_completed":false}'
    exit 0
  fi
  [[ "$status" == 0 ]] || { echo '{"upload_completed":false}'; exit 2; }
fi
if [[ "$mode" == trial ]]; then
  echo '{"parallel_trial_finished":true,"upload_completed":true}'
  exit 0
fi
tar -czf "$private/code.tar.gz" -C "$root" \
  ops/cd/deploy-existing.py ops/cd/artifact.py ops/cd/deploy.py ops/database.py ops/nginx.conf \
  ops/cd/repair_existing_web.py ops/cd/release_identity.py ops/cd/channel_gateway.py
printf 'put "%s" "%s/code.tar.gz"\n' "$private/code.tar.gz" "$upload" > "$private/batch"
if ! timeout --signal=TERM 120s sftp -q "${opts[@]}" -P "$port" \
  -b "$private/batch" "$target" > "$private/transfer.log" 2>&1; then
  echo '{"upload_completed":false}'
  exit 2
fi
ssh "${opts[@]}" -p "$port" "$target" "sudo -n python3 - verify $size $EXPECTED_SHA256 $upload" \
  < "$root/ops/cd/upload-state.py" > /dev/null
echo '{"upload_completed":true}'
printf '%s\n' "$upload" > "$state"
else
  IFS= read -r upload < "$state"
  [[ "$upload" =~ ^/tmp/everplain-candidate\.[A-Za-z0-9]+$ ]] || exit 2
  ssh "${opts[@]}" -p "$port" "$target" "sudo -n python3 - verify $size $EXPECTED_SHA256 $upload" \
    < "$root/ops/cd/upload-state.py" > /dev/null
fi
[[ "$mode" != upload ]] || exit 0
# No secret or private production metadata appears in argv or public output.
printf '%s\n' "${EVERPLAIN_REGISTRY_TOKEN:-}" | ssh "${opts[@]}" -p "$port" "$target" \
  "tar -xzf $upload/code.tar.gz -C $upload && sudo -n python3 $upload/ops/cd/deploy-existing.py $upload/release.tar.gz $GITHUB_SHA $EXPECTED_SHA256 $GITHUB_RUN_ID $GITHUB_RUN_ATTEMPT"
