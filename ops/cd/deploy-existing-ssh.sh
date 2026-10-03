#!/usr/bin/env bash
# Publish only the fixed, previously built candidate using the existing account and secret.
set -euo pipefail
umask 077
for name in EVERPLAIN_DEPLOY_HOST EVERPLAIN_DEPLOY_USER EVERPLAIN_DEPLOY_PORT EVERPLAIN_SSH_HOST_KEY_FINGERPRINT EVERPLAIN_SSH_PRIVATE_KEY; do
  [[ -n "${!name:-}" ]] || { echo "Missing required production setting: $name" >&2; exit 2; }
done
[[ "$EVERPLAIN_DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 2
[[ "$EVERPLAIN_DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || exit 2
[[ "$EVERPLAIN_DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] || exit 2
port=$((10#$EVERPLAIN_DEPLOY_PORT))
(( port > 0 && port < 65536 )) || exit 2
[[ "$EVERPLAIN_SSH_HOST_KEY_FINGERPRINT" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || exit 2
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
root="$(cd "$(dirname "$0")/../.." && pwd)"
archive="$root/dist/release/everplain.tar.gz"
[[ "$(sha256sum "$archive" | cut -d ' ' -f 1)" == "85f2b033ed68e94d9d0563800d3d5b078c4b4e2d7b6ad868c4a3fa2e0cf3ec03" ]] || {
  echo 'Checked artifact digest mismatch; no deployment attempted' >&2; exit 2;
}
target="$EVERPLAIN_DEPLOY_USER@$EVERPLAIN_DEPLOY_HOST"
upload="$(ssh "${opts[@]}" -p "$port" "$target" 'mktemp -d /tmp/everplain-candidate.XXXXXXXX')"
[[ "$upload" =~ ^/tmp/everplain-candidate\.[A-Za-z0-9]+$ ]] || exit 2
tar -czf "$private/code.tar.gz" -C "$root" \
  ops/cd/deploy-existing.py ops/cd/artifact.py ops/cd/deploy.py ops/database.py ops/nginx.conf
scp "${opts[@]}" -P "$port" "$archive" "$target:$upload/release.tar.gz"
scp "${opts[@]}" -P "$port" "$private/code.tar.gz" "$target:$upload/code.tar.gz"
# No secret or private production metadata appears in argv or public output.
ssh "${opts[@]}" -p "$port" "$target" \
  "tar -xzf $upload/code.tar.gz -C $upload && sudo -n python3 $upload/ops/cd/deploy-existing.py $upload/release.tar.gz"
