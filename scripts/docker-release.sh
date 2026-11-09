#!/usr/bin/env bash
#
# Build and push the Nightingale Docker images (CPU + CUDA) to GHCR and Docker Hub.
#
# Replaces the removed `publish-docker` CI job — run it locally instead.
#
# Usage:
#   VERSION=1.2.3 ./scripts/docker-release.sh [cpu|cuda|all]
#
# Environment variables:
#   VERSION            (required) release version, e.g. 1.2.3 (tag without the leading v)
#   GHCR_IMAGE         GHCR image name        (default: ghcr.io/rzru/nightingale)
#   DOCKERHUB_IMAGE    Docker Hub image name  (default: razzaru/nightingale)
#   PIXABAY_API_KEY    optional; baked into the binary for video backgrounds
#   PLATFORMS_CPU      CPU target platforms   (default: linux/amd64,linux/arm64)
#   RUNTIME_BASE_CUDA  CUDA runtime base      (default: nvidia/cuda:12.6.2-runtime-ubuntu24.04)
#   PUSH               set to 0 to build without pushing (default: 1)
#   SEQUENTIAL         build each CPU platform one at a time (default: 1);
#                      set 0 for the old single-call parallel multi-arch build.
#                      Sequential mode requires PUSH=1 (arch tags are combined
#                      into the final manifest via the registry).
#
# Prerequisites (one-time):
#   docker buildx create --name nb --use --bootstrap
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
#   docker login -u <dockerhub-username>

set -euo pipefail

# ── Resolve paths ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKERFILE="$REPO_ROOT/docker/Dockerfile"

# ── Config ────────────────────────────────────────────────────────────────
: "${VERSION:?VERSION is required (e.g. VERSION=1.2.3 $0)}"

GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/rzru/nightingale}"
DOCKERHUB_IMAGE="${DOCKERHUB_IMAGE:-razzaru/nightingale}"
PIXABAY_API_KEY="${PIXABAY_API_KEY:-}"
PLATFORMS_CPU="${PLATFORMS_CPU:-linux/amd64,linux/arm64}"
RUNTIME_BASE_CUDA="${RUNTIME_BASE_CUDA:-nvidia/cuda:12.6.2-runtime-ubuntu24.04}"
PUSH="${PUSH:-1}"
# SEQUENTIAL=1 (default): build each CPU platform one at a time to avoid
# hammering the machine with a native + QEMU-emulated build in parallel.
# Set SEQUENTIAL=0 to restore the old single-call multi-platform build.
SEQUENTIAL="${SEQUENTIAL:-1}"

TARGET="${1:-all}"

if [[ "$PUSH" == "1" ]]; then
  OUTPUT_FLAG="--push"
else
  OUTPUT_FLAG=""
  echo "PUSH=0 → building without pushing (multi-arch images stay in the build cache only)."
fi

# Build + push a single platform to arch-suffixed tags on both registries.
build_cpu_one() {
  local platform="$1"                 # e.g. linux/amd64
  local arch="${platform##*/}"         # e.g. amd64
  echo "==> Building CPU image [$platform] :${VERSION}-${arch}"
  docker buildx build \
    -f "$DOCKERFILE" \
    --platform "$platform" \
    --build-arg PIXABAY_API_KEY="$PIXABAY_API_KEY" \
    -t "$GHCR_IMAGE:$VERSION-$arch" \
    -t "$DOCKERHUB_IMAGE:$VERSION-$arch" \
    --push \
    "$REPO_ROOT"
}

# Stitch the per-arch tags into the final multi-arch manifests, per registry.
assemble_manifest() {
  local image="$1"
  local -a srcs=()
  local p arch
  IFS=',' read -ra _plats <<< "$PLATFORMS_CPU"
  for p in "${_plats[@]}"; do
    arch="${p##*/}"
    srcs+=("$image:$VERSION-$arch")
  done
  echo "==> Assembling manifest $image:$VERSION and :latest from ${srcs[*]}"
  docker buildx imagetools create -t "$image:$VERSION" -t "$image:latest" "${srcs[@]}"
}

build_cpu() {
  if [[ "$SEQUENTIAL" != "1" ]]; then
    echo "==> Building CPU image (${PLATFORMS_CPU}, parallel) :${VERSION}, :latest"
    docker buildx build \
      -f "$DOCKERFILE" \
      --platform "$PLATFORMS_CPU" \
      --build-arg PIXABAY_API_KEY="$PIXABAY_API_KEY" \
      -t "$GHCR_IMAGE:$VERSION" -t "$GHCR_IMAGE:latest" \
      -t "$DOCKERHUB_IMAGE:$VERSION" -t "$DOCKERHUB_IMAGE:latest" \
      $OUTPUT_FLAG \
      "$REPO_ROOT"
    return
  fi

  if [[ "$PUSH" != "1" ]]; then
    echo "ERROR: SEQUENTIAL multi-arch build requires PUSH=1 (arch tags are" >&2
    echo "       combined via the registry). For a local build set SEQUENTIAL=0" >&2
    echo "       and a single --platform, e.g. PLATFORMS_CPU=linux/amd64." >&2
    exit 1
  fi

  # One platform at a time so a native build and a QEMU-emulated build never
  # run concurrently.
  IFS=',' read -ra _plats <<< "$PLATFORMS_CPU"
  for p in "${_plats[@]}"; do
    build_cpu_one "$p"
  done

  assemble_manifest "$GHCR_IMAGE"
  assemble_manifest "$DOCKERHUB_IMAGE"
}

build_cuda() {
  echo "==> Building CUDA image (linux/amd64) :${VERSION}-cuda, :latest-cuda"
  docker buildx build \
    -f "$DOCKERFILE" \
    --platform linux/amd64 \
    --build-arg RUNTIME_BASE="$RUNTIME_BASE_CUDA" \
    --build-arg PIXABAY_API_KEY="$PIXABAY_API_KEY" \
    -t "$GHCR_IMAGE:$VERSION-cuda" -t "$GHCR_IMAGE:latest-cuda" \
    -t "$DOCKERHUB_IMAGE:$VERSION-cuda" -t "$DOCKERHUB_IMAGE:latest-cuda" \
    $OUTPUT_FLAG \
    "$REPO_ROOT"
}

case "$TARGET" in
  cpu)  build_cpu ;;
  cuda) build_cuda ;;
  all)  build_cpu; build_cuda ;;
  *)
    echo "Unknown target '$TARGET' (expected: cpu | cuda | all)" >&2
    exit 1
    ;;
esac

echo "==> Done."
