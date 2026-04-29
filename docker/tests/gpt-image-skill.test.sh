#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DOCKER_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

test -f "${DOCKER_ROOT}/skills/gpt-image-api/SKILL.md"
test -f "${DOCKER_ROOT}/skills/gpt-image-api/scripts/opencode-gpt-image"
grep -Fq "/usr/local/bin/opencode-gpt-image" "${DOCKER_ROOT}/skills/gpt-image-api/SKILL.md"

if grep -R -E 'sk-[A-Za-z0-9]|192\.168\.2\.211:8317|OPENAI_API_KEY=' "${DOCKER_ROOT}/skills/gpt-image-api" "${DOCKER_ROOT}/bin/gpt-image-proxy.mjs"; then
  echo "GPT image skill/proxy files must not contain upstream secrets" >&2
  exit 1
fi

sh -n "${DOCKER_ROOT}/skills/gpt-image-api/scripts/opencode-gpt-image"
node --check "${DOCKER_ROOT}/bin/opencode-gpt-image"
node --check "${DOCKER_ROOT}/bin/gpt-image-proxy.mjs"
node --check "${DOCKER_ROOT}/bin/gemini-media-proxy.mjs"
node "${DOCKER_ROOT}/tests/gemini-media-proxy-contract.test.mjs"
node "${DOCKER_ROOT}/tests/gpt-image-proxy-contract.test.mjs"
node "${DOCKER_ROOT}/tests/gpt-image-helper-output-dir.test.mjs"

printf 'ok: gpt image skill scripts are packaged without upstream secrets\n'
