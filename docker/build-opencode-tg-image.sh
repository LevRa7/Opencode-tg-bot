#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source "${SCRIPT_DIR}/bin/docker-env.sh"
opencode_init_docker_env

IMAGE="${OPENCODE_DOCKER_IMAGE:-opencode-tg:local}"
TG_CLI_SOURCE_DIR="${TG_CLI_SOURCE_DIR:-${SCRIPT_DIR}/tg-cli}"
VENDOR_DIR="${SCRIPT_DIR}/vendor"
BASE_IMAGE="${OPENCODE_BASE_IMAGE:-ghcr.io/anomalyco/opencode:latest}"

if ! docker image inspect "$BASE_IMAGE" >/dev/null 2>&1; then
  echo "Required local base image not found: $BASE_IMAGE" >&2
  echo "Load or pull it once before offline rebuilds." >&2
  exit 1
fi

if [[ ! -d "$TG_CLI_SOURCE_DIR" ]]; then
  echo "Local tg-cli source not found: $TG_CLI_SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$VENDOR_DIR"
rm -rf "$VENDOR_DIR/python-tg-cli" "$VENDOR_DIR/tg-cli-dist"

mkdir -p "$VENDOR_DIR/python-tg-cli"
rsync -a --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  "$TG_CLI_SOURCE_DIR/" "$VENDOR_DIR/python-tg-cli/"

echo "Using local base image: $BASE_IMAGE"
echo "Vendored Python tg-cli source from: $TG_CLI_SOURCE_DIR"
echo "Building tg-cli into the image from local vendored source"
docker build -t "$IMAGE" "$SCRIPT_DIR"
