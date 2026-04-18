#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

WORKSPACE_DIR="${TMP_DIR}/workspace"
STATE_DIR="${TMP_DIR}/state"
HOST_CONFIG_DIR="${TMP_DIR}/config"

mkdir -p "${WORKSPACE_DIR}" "${STATE_DIR}" "${HOST_CONFIG_DIR}"

cat > "${WORKSPACE_DIR}/AGENTS.md" <<'EOF'
# Project Instructions

- Keep workspace instructions separate.
EOF

cat > "${HOST_CONFIG_DIR}/AGENTS.md" <<'EOF'
# User Global Instructions

- Prefer terse answers.
EOF

docker run --rm \
  --entrypoint sh \
  -e XDG_CONFIG_HOME=/state/config \
  -v "${WORKSPACE_DIR}:/workspace" \
  -v "${STATE_DIR}:/state" \
  -v "${HOST_CONFIG_DIR}/AGENTS.md:/etc/opencode/AGENTS.md:ro" \
  opencode-tg:local \
  -c 'merge-agents >/dev/null; test -f /state/config/opencode/AGENTS.md; grep -Fq "Prefer terse answers." /state/config/opencode/AGENTS.md; grep -Fq "Whisper STT batch transcription" /state/config/opencode/AGENTS.md; ! grep -Fq "Keep workspace instructions separate." /state/config/opencode/AGENTS.md; grep -Fq "Keep workspace instructions separate." /workspace/AGENTS.md'

printf 'ok\n'
