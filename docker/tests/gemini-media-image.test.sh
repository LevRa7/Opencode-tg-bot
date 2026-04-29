#!/usr/bin/env bash
set -euo pipefail

IMAGE="${OPENCODE_DOCKER_IMAGE:-opencode-tg:local}"
DOCKER_CMD="${DOCKER_CMD:-docker}"

if ! "${DOCKER_CMD}" image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "FAIL: Docker image not found: ${IMAGE}" >&2
  exit 1
fi

"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'grep -Fq "setpriv --reuid=0 --regid=0 --clear-groups --bounding-set=-all --nnp opencode" /usr/local/bin/docker-entrypoint.sh'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode-gemini-media >/dev/null && test -f /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode-gpt-image >/dev/null && test -f /usr/local/lib/opencode-gpt-image/gpt-image-proxy.mjs'

printf 'ok: media helpers are present and entrypoint drops runtime capabilities\n'
