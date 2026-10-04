#!/usr/bin/env bash
# Verified existing SSH account; default inspection or explicit Everplain-only web repair.
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
case "${1:-inspect}" in
  inspect) script=inspect-production.py ;;
  repair-web) script=repair_existing_web.py ;;
  *) exit 2 ;;
esac
echo 'Approved ED25519 host fingerprint verified'
# Uses only the existing sudo capability. The selected operation is fixed above.
ssh "${opts[@]}" -p "$port" "$EVERPLAIN_DEPLOY_USER@$EVERPLAIN_DEPLOY_HOST" \
  'sudo -n python3 -' < "$root/ops/cd/$script"

if [[ "${1:-inspect}" == inspect ]]; then
  # Stream the checked helper via stdin; install nothing and expose only hashes.
  echo 'EVERPLAIN_RUNTIME_FINGERPRINT_BEGIN'
  ssh "${opts[@]}" -p "$port" "$EVERPLAIN_DEPLOY_USER@$EVERPLAIN_DEPLOY_HOST" \
    'sudo -n python3 - inspect' < "$root/ops/cd/release_identity.py"
  echo 'EVERPLAIN_RUNTIME_FINGERPRINT_END'
fi
