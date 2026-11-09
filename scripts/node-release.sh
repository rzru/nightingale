#!/usr/bin/env bash
#
# Build and push the nightingale-node image to GHCR and Docker Hub.
#
# The node image is much smaller than the app image: no frontend bundle, no ML
# stack, no music library. It is built for both amd64 and arm64 so it runs on a
# VPS or a NAS.
#
# Usage:
#   VERSION=1.2.3 ./scripts/node-release.sh
#
# Environment variables:
#   VERSION            (required) release version, e.g. 1.2.3 (tag without the leading v)
#   GHCR_IMAGE         GHCR image name        (default: ghcr.io/rzru/nightingale-node)
#   DOCKERHUB_IMAGE    Docker Hub image name  (default: razzaru/nightingale-node)
#   PLATFORMS          target platforms       (default: linux/amd64,linux/arm64)
#   PUSH               set to 0 to build without pushing (default: 1)
#
# Prerequisites (one-time):
#   docker buildx create --name nb --use --bootstrap
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
#   docker login -u <dockerhub-username>

set -euo pipefail

# ── Resolve paths ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKERFILE="$REPO_ROOT/docker/node.Dockerfile"

# ── Config ────────────────────────────────────────────────────────────────
: "${VERSION:?VERSION is required (e.g. VERSION=1.2.3 $0)}"

GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/rzru/nightingale-node}"
DOCKERHUB_IMAGE="${DOCKERHUB_IMAGE:-razzaru/nightingale-node}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH="${PUSH:-1}"

if [[ "$PUSH" != "1" ]]; then
  echo "ERROR: multi-arch manifests are stitched through the registry, so this" >&2
  echo "       script always pushes. Build a single platform by hand instead:" >&2
  echo "       docker buildx build -f docker/node.Dockerfile --platform linux/amd64 -t node:dev ." >&2
  exit 1
fi

# One platform at a time so a native build and a QEMU-emulated build never run
# concurrently, then stitch the arch tags into the final manifests.
IFS=',' read -ra PLATFORM_LIST <<< "$PLATFORMS"
for platform in "${PLATFORM_LIST[@]}"; do
  arch="${platform##*/}"
  echo "==> Building node image [$platform] :${VERSION}-${arch}"
  docker buildx build \
    -f "$DOCKERFILE" \
    --platform "$platform" \
    -t "$GHCR_IMAGE:$VERSION-$arch" \
    -t "$DOCKERHUB_IMAGE:$VERSION-$arch" \
    --push \
    "$REPO_ROOT"
done

for image in "$GHCR_IMAGE" "$DOCKERHUB_IMAGE"; do
  sources=()
  for platform in "${PLATFORM_LIST[@]}"; do
    sources+=("$image:$VERSION-${platform##*/}")
  done
  echo "==> Assembling manifest $image:$VERSION and :latest"
  docker buildx imagetools create -t "$image:$VERSION" -t "$image:latest" "${sources[@]}"
done

echo "==> Done."
