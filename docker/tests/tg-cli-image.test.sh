#!/usr/bin/env bash
set -euo pipefail

IMAGE="${OPENCODE_DOCKER_IMAGE:-opencode-tg:local}"
DOCKER_CMD="${DOCKER_CMD:-docker}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

if ! "${DOCKER_CMD}" image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "FAIL: Docker image not found: ${IMAGE}" >&2
  exit 1
fi

"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v tg >/dev/null && command -v telegram-cli >/dev/null && command -v tg-cli >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'tg --help >/dev/null'
"${DOCKER_CMD}" run --rm \
  --entrypoint sh \
  -e TG_API_ID=123 \
  -e TG_API_HASH=abc \
  "${IMAGE}" \
  -lc 'command -v opencode-tg-cli >/dev/null && opencode-tg-cli --help >/dev/null'

printf 'ok: tg-cli is present in the image\n'
