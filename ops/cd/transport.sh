#!/usr/bin/env bash
# Only a fixed, operator-installed per-application controller is executable remotely.
set -euo pipefail
umask 077
operation="${1:-}"
[[ "$operation" == deploy || "$operation" == rollback-previous ]] || exit 2
for name in EVERPLAIN_DEPLOY_HOST EVERPLAIN_DEPLOY_USER EVERPLAIN_DEPLOY_PORT EVERPLAIN_SSH_PRIVATE_KEY EVERPLAIN_SSH_KNOWN_HOSTS; do
  [[ -n "${!name:-}" ]] || { echo "Missing required production setting: $name" >&2; exit 2; }
done
[[ "$EVERPLAIN_DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 2
[[ "$EVERPLAIN_DEPLOY_USER" =~ ^everplain[-a-z0-9_]*$ ]] || exit 2
[[ "$EVERPLAIN_DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] || exit 2
port=$((10#$EVERPLAIN_DEPLOY_PORT))
(( port > 0 && port < 65536 )) || exit 2
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 2
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || exit 2
private="$(mktemp -d)"
cleanup() {
  rc=$?
  rm -rf "$private"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf 'Everplain %s: exit %s\n\nSource: %s\n\nRun: %s\n' "$operation" "$rc" "$GITHUB_SHA" "$GITHUB_RUN_ID" >> "$GITHUB_STEP_SUMMARY"
    printf '\nHealth/configuration checks do not verify paid model calls or browser flows.\n' >> "$GITHUB_STEP_SUMMARY"
  fi
}
trap cleanup EXIT
printf '%s\n' "$EVERPLAIN_SSH_PRIVATE_KEY" > "$private/key"
printf '%s\n' "$EVERPLAIN_SSH_KNOWN_HOSTS" > "$private/known_hosts"
unset EVERPLAIN_SSH_PRIVATE_KEY EVERPLAIN_SSH_KNOWN_HOSTS
opts=(-i "$private/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$private/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
target="$EVERPLAIN_DEPLOY_USER@$EVERPLAIN_DEPLOY_HOST"
if [[ "$operation" == deploy ]]; then
  [[ "${EXPECTED_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || exit 2
  [[ "$(sha256sum dist/release/everplain.tar.gz | cut -d ' ' -f 1)" == "$EXPECTED_SHA256" ]] || { echo 'Downloaded artifact checksum mismatch' >&2; exit 1; }
  # Numeric run ID and full SHA are the only variable filename components.
  scp "${opts[@]}" -P "$port" dist/release/everplain.tar.gz "$target:/srv/everplain/incoming/$GITHUB_RUN_ID-$GITHUB_SHA.tar.gz"
  ssh "${opts[@]}" -p "$port" "$target" "sudo -n /usr/local/lib/everplain/cd/deploy.py deploy $GITHUB_SHA $EXPECTED_SHA256 $GITHUB_RUN_ID" | tee "$private/result"
else
  ssh "${opts[@]}" -p "$port" "$target" "sudo -n /usr/local/lib/everplain/cd/deploy.py rollback-previous $GITHUB_RUN_ID" | tee "$private/result"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$private/result" >> "$GITHUB_STEP_SUMMARY"
fi
