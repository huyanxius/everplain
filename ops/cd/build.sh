#!/usr/bin/env bash
# CI-only build. No runtime secrets or production connection required.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected full GITHUB_SHA' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo 'Checkout revision mismatch' >&2; exit 1; }
prepared="$(mktemp -d)"
export DOCKER_CONFIG="$prepared/docker-auth"
mkdir -m 700 "$DOCKER_CONFIG"
publish="${EVERPLAIN_PUBLISH_IMAGES:-false}"
if [[ "$publish" == true ]]; then
  [[ -n "${EVERPLAIN_REGISTRY_TOKEN:-}" ]] || exit 2
  printf '%s' "$EVERPLAIN_REGISTRY_TOKEN" | docker login ghcr.io -u huyanxius --password-stdin >/dev/null 2>&1
  unset EVERPLAIN_REGISTRY_TOKEN
  # Cache tags are build inputs only; the release pins immutable registry digests.
  for role in api web gateway; do
    docker pull "ghcr.io/huyanxius/everplain-$role:build-cache" >/dev/null 2>&1 || true
  done
  docker pull ghcr.io/huyanxius/everplain-web:builder-cache >/dev/null 2>&1 || true
fi
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
  --cache-from ghcr.io/huyanxius/everplain-api:build-cache --build-arg BUILDKIT_INLINE_CACHE=1 \
  --build-arg "PYTHON_IMAGE=$python_image" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  -t "everplain-api:$GITHUB_SHA" .
docker build --platform linux/amd64 -f gateway/Dockerfile \
  --cache-from ghcr.io/huyanxius/everplain-gateway:build-cache \
  --build-arg BUILDKIT_INLINE_CACHE=1 --build-arg "PYTHON_IMAGE=$python_image" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  -t "everplain-gateway:$GITHUB_SHA" gateway
web_build=(--platform linux/amd64 -f ops/web.Dockerfile
  --cache-from ghcr.io/huyanxius/everplain-web:build-cache
  --cache-from ghcr.io/huyanxius/everplain-web:builder-cache
  --build-arg BUILDKIT_INLINE_CACHE=1
  --build-arg "NODE_IMAGE=$node_image" --build-arg "NGINX_IMAGE=$nginx_image"
  --build-arg "RELEASE_REVISION=$GITHUB_SHA")
if [[ "$publish" == true ]]; then
  # Export the builder as its own image: final-stage inline cache does not retain
  # the npm/asset layers. This trusted main-only cache is never a release artifact.
  docker build "${web_build[@]}" --target build -t everplain-web-builder:cache .
  docker tag everplain-web-builder:cache ghcr.io/huyanxius/everplain-web:builder-cache
  docker push ghcr.io/huyanxius/everplain-web:builder-cache || echo 'Builder cache unavailable; release continues.' >&2
fi
docker build "${web_build[@]}" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  -t "everplain-web:$GITHUB_SHA" .
if [[ "$publish" == true ]]; then
  for role in api web gateway; do
    name="ghcr.io/huyanxius/everplain-$role"
    docker tag "everplain-$role:$GITHUB_SHA" "$name:$GITHUB_SHA"
    docker push "$name:$GITHUB_SHA"
    docker tag "everplain-$role:$GITHUB_SHA" "$name:build-cache"
    docker push "$name:build-cache"
    docker image inspect "$name:$GITHUB_SHA" > "$prepared/$role-image.json"
  done
  python3 - "$prepared" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); references={}; sizes={}
for role in ('api','web','gateway'):
    image=json.loads((p/(role+'-image.json')).read_text())[0]
    references[role]=next(r for r in image['RepoDigests'] if r.startswith('ghcr.io/huyanxius/everplain-'+role+'@'))
    sizes[role]=image['Size']
(p/'registry.json').write_text(json.dumps(references))
(p/'image-sizes.json').write_text(json.dumps(sizes))
PY
else
  docker save "everplain-api:$GITHUB_SHA" -o "$prepared/images/api.tar"
  docker save "everplain-web:$GITHUB_SHA" -o "$prepared/images/web.tar"
  docker save "everplain-gateway:$GITHUB_SHA" -o "$prepared/images/gateway.tar"
fi
# Read built bytes without starting a container or running application/model code.
web_container="$(docker create "everplain-web:$GITHUB_SHA")"
mkdir -p "$prepared/web"
docker cp "$web_container:/usr/share/nginx/html/." "$prepared/web/"
docker rm "$web_container" >/dev/null
web_container=""
api_id="$(docker image inspect "everplain-api:$GITHUB_SHA" --format '{{.Id}}')"
web_id="$(docker image inspect "everplain-web:$GITHUB_SHA" --format '{{.Id}}')"
gateway_id="$(docker image inspect "everplain-gateway:$GITHUB_SHA" --format '{{.Id}}')"
bash gateway/scripts/verify-container.sh "$gateway_id" "$GITHUB_SHA"
python ops/cd/release_identity.py probe-image "$api_id" > "$prepared/api-identity.json"
python ops/cd/artifact.py "$GITHUB_SHA" --prepared "$prepared" --output dist/release \
  --api-image "$api_id" --web-image "$web_id" --gateway-image "$gateway_id" \
  --python-base "$python_image" --node-base "$node_image" --nginx-base "$nginx_image"
