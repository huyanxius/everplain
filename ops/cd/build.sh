#!/usr/bin/env bash
# CI-only build. No runtime secrets or production connection required.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected full GITHUB_SHA' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo 'Checkout revision mismatch' >&2; exit 1; }
prepared="$(mktemp -d)"
web_container=""
cleanup() {
  [[ -z "$web_container" ]] || docker rm "$web_container" >/dev/null
  rm -rf "$prepared"
}
trap cleanup EXIT
mkdir -p "$prepared/images"
# Resolve official base tags ONCE and record their immutable registry digests.
for spec in python:3.12-slim-bookworm node:22-bookworm-slim nginx:stable-alpine; do
  docker pull --platform linux/amd64 "$spec"
done
python_image="$(docker image inspect python:3.12-slim-bookworm --format '{{index .RepoDigests 0}}')"
node_image="$(docker image inspect node:22-bookworm-slim --format '{{index .RepoDigests 0}}')"
nginx_image="$(docker image inspect nginx:stable-alpine --format '{{index .RepoDigests 0}}')"
docker build --platform linux/amd64 -f ops/api.Dockerfile \
  --build-arg "PYTHON_IMAGE=$python_image" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  -t "everplain-api:$GITHUB_SHA" .
docker build --platform linux/amd64 -f ops/web.Dockerfile \
  --build-arg "NODE_IMAGE=$node_image" --build-arg "NGINX_IMAGE=$nginx_image" \
  --build-arg "RELEASE_REVISION=$GITHUB_SHA" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  -t "everplain-web:$GITHUB_SHA" .
docker save "everplain-api:$GITHUB_SHA" -o "$prepared/images/api.tar"
docker save "everplain-web:$GITHUB_SHA" -o "$prepared/images/web.tar"
# Read built bytes without starting a container or running application/model code.
web_container="$(docker create "everplain-web:$GITHUB_SHA")"
mkdir -p "$prepared/web"
docker cp "$web_container:/usr/share/nginx/html/." "$prepared/web/"
docker rm "$web_container" >/dev/null
web_container=""
api_id="$(docker image inspect "everplain-api:$GITHUB_SHA" --format '{{.Id}}')"
web_id="$(docker image inspect "everplain-web:$GITHUB_SHA" --format '{{.Id}}')"
python ops/cd/artifact.py "$GITHUB_SHA" --prepared "$prepared" --output dist/release \
  --api-image "$api_id" --web-image "$web_id" \
  --python-base "$python_image" --node-base "$node_image" --nginx-base "$nginx_image"
