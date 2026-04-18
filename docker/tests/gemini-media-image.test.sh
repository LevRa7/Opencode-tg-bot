#!/usr/bin/env bash
set -euo pipefail

IMAGE="${OPENCODE_DOCKER_IMAGE:-opencode-tg:local}"
DOCKER_CMD="${DOCKER_CMD:-docker}"

if ! "${DOCKER_CMD}" image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "FAIL: Docker image not found: ${IMAGE}" >&2
  exit 1
fi

"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'grep -Fq "setpriv --reuid=1000 --regid=1000 --clear-groups opencode" /usr/local/bin/docker-entrypoint.sh'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode-gemini-media >/dev/null && test -f /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs'

printf 'ok: gemini media helper is present and entrypoint drops privileges\n'
