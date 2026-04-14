#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TARGET_SCRIPT="${SCRIPT_DIR}/../run-opencode-serve.sh"
DOCKER_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

TMP_DIR="$(mktemp -d)"
cleanup() {
  if [[ -n "${SOCKET_PID:-}" ]]; then
    kill "${SOCKET_PID}" >/dev/null 2>&1 || true
    wait "${SOCKET_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

FAKE_HOME="${TMP_DIR}/home"
FAKE_WORKSPACES_ROOT="${TMP_DIR}/workspaces"
FAKE_BIN="${TMP_DIR}/bin"
FAKE_RUNTIME_DIR="${TMP_DIR}/runtime"
DOCKER_ARGS_FILE="${TMP_DIR}/docker-args.txt"
DOCKER_ENV_FILE="${TMP_DIR}/docker-env.txt"
SOCKET_PATH="${FAKE_RUNTIME_DIR}/docker.sock"

mkdir -p \
  "${FAKE_HOME}/.config/opencode" \
  "${FAKE_HOME}/.local/share/opencode" \
  "${FAKE_WORKSPACES_ROOT}" \
  "${FAKE_BIN}" \
  "${FAKE_RUNTIME_DIR}"
touch "${FAKE_HOME}/.local/share/opencode/auth.json"
cat > "${FAKE_HOME}/.config/opencode/opencode.json" <<'EOF'
{
  "plugin": [
    "superpowers@git+https://example.invalid/superpowers.git"
  ],
  "skills": {
    "paths": [
      "~/.config/opencode/skills",
      "/home/me/MyProjects/opencode-tg/skills"
    ]
  },
  "model": "cliproxyapi/gpt-5.4-mini",
  "provider": {
    "cliproxyapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CliProxyApi",
      "options": {
        "baseURL": "http://127.0.0.1:8317/v1"
      },
      "models": {
        "gpt-5.4-mini": {
          "name": "GPT-5.4 Mini"
        },
        "gpt-5.4": {
          "name": "GPT-5.4"
        }
      }
    }
  },
  "mcp": {
    "puppeteer": {
      "type": "local"
    }
  }
}
EOF

python3 -c 'import socket, sys, time; sock = socket.socket(socket.AF_UNIX); sock.bind(sys.argv[1]); sock.listen(1); time.sleep(300)' \
  "${SOCKET_PATH}" &
SOCKET_PID=$!

for _ in {1..50}; do
  if [[ -S "${SOCKET_PATH}" ]]; then
    break
  fi
  sleep 0.1
done
test -S "${SOCKET_PATH}"

cat > "${FAKE_BIN}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "version" ]]; then
  printf 'version\t%s\t%s\n' "${DOCKER_CONFIG:-}" "${DOCKER_HOST:-}" >> "${DOCKER_ENV_FILE}"
  exit 0
fi

if [[ "$#" -ge 2 && "$1" == "image" && "$2" == "inspect" ]]; then
  exit 0
fi

if [[ "$#" -ge 2 && "$1" == "ps" ]]; then
  printf 'opencode-serve-tg-999\t127.0.0.1:49600->4096/tcp\n'
  exit 0
fi

if [[ "$#" -ge 2 && "$1" == "rm" && "$2" == "-f" ]]; then
  exit 0
fi

if [[ "$1" == "run" ]]; then
  printf 'run\t%s\t%s\n' "${DOCKER_CONFIG:-}" "${DOCKER_HOST:-}" >> "${DOCKER_ENV_FILE}"
  printf '%s\n' "$@" > "${DOCKER_ARGS_FILE}"
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 1
EOF

chmod +x "${FAKE_BIN}/docker"

export HOME="${FAKE_HOME}"
export PATH="${FAKE_BIN}:${PATH}"
export XDG_RUNTIME_DIR="${FAKE_RUNTIME_DIR}"
export DOCKER_ARGS_FILE
export DOCKER_ENV_FILE
export WORKSPACES_ROOT="${FAKE_WORKSPACES_ROOT}"
export TG_ID="123456"
export TG_CHAT_ID="123456"
export TG_TENANT_ID="tenant-alpha"
export OPENCODE_SERVER_PASSWORD="test-password"
export CLIPROXYAPI_BASE_URL="http://192.168.2.166:8317/v1"
unset DOCKER_HOST
unset DOCKER_CONFIG

bash "${TARGET_SCRIPT}" >/dev/null

TENANT_ROOT="${FAKE_WORKSPACES_ROOT}/tenant-alpha"
WORKSPACE_DIR="${TENANT_ROOT}/workspace"
STATE_DIR="${TENANT_ROOT}/state"
EXPECTED_DOCKER_CONFIG="${DOCKER_ROOT}/.docker-config"
EXPECTED_DOCKER_HOST="unix://${SOCKET_PATH}"

test -d "${WORKSPACE_DIR}"
test -d "${STATE_DIR}"
test -f "${STATE_DIR}/MAP.md"
test -f "${STATE_DIR}/config/opencode.json"
test -f "${WORKSPACE_DIR}/AGENTS.md"
grep -Fq "/state/MAP.md" "${WORKSPACE_DIR}/AGENTS.md"
grep -Fq "state/opencode" "${STATE_DIR}/MAP.md"
grep -Fq "state/tg-cli" "${STATE_DIR}/MAP.md"
grep -Fq "state/skills" "${STATE_DIR}/MAP.md"
grep -Fq '"/state/skills"' "${STATE_DIR}/config/opencode.json"
if grep -Fq '"/workspace/skills"' "${STATE_DIR}/config/opencode.json"; then
  echo "tenant config should not include workspace skills" >&2
  exit 1
fi
grep -Fx -- $'version\t'"${EXPECTED_DOCKER_CONFIG}"$'\t'"${EXPECTED_DOCKER_HOST}" "${DOCKER_ENV_FILE}"
grep -Fx -- $'run\t'"${EXPECTED_DOCKER_CONFIG}"$'\t'"${EXPECTED_DOCKER_HOST}" "${DOCKER_ENV_FILE}"

if grep -Fxq -- "--read-only" "${DOCKER_ARGS_FILE}"; then
  echo "container rootfs should be writable" >&2
  exit 1
fi
if grep -Fxq -- "--tmpfs" "${DOCKER_ARGS_FILE}"; then
  echo "launcher should not force tmpfs mounts for writable rootfs" >&2
  exit 1
fi
grep -Fx -- "HOME=/workspace" "${DOCKER_ARGS_FILE}"
grep -Fx -- "XDG_CONFIG_HOME=/state/config" "${DOCKER_ARGS_FILE}"
grep -Fx -- "XDG_CACHE_HOME=/state/cache" "${DOCKER_ARGS_FILE}"
grep -Fx -- "XDG_STATE_HOME=/state/xdg-state" "${DOCKER_ARGS_FILE}"
grep -Fx -- "OPENCODE_CONFIG_DIR=/bootstrap/opencode-config" "${DOCKER_ARGS_FILE}"
grep -Fx -- "OPENCODE_DISABLE_EXTERNAL_SKILLS=true" "${DOCKER_ARGS_FILE}"
grep -Fx -- "${STATE_DIR}/config:/bootstrap/opencode-config:ro" "${DOCKER_ARGS_FILE}"
grep -Fx -- "${FAKE_HOME}/.local/share/opencode/auth.json:/bootstrap/opencode-auth/auth.json:ro" "${DOCKER_ARGS_FILE}"
grep -Fx -- "${WORKSPACE_DIR}:/workspace" "${DOCKER_ARGS_FILE}"
grep -Fq '"baseURL": "http://192.168.2.166:8317/v1"' "${STATE_DIR}/config/opencode.json"
grep -Fq '"model": "cliproxyapi/gpt-5.4-mini"' "${STATE_DIR}/config/opencode.json"
grep -Fq '"gpt-5.4-mini"' "${STATE_DIR}/config/opencode.json"
grep -Fq '"gpt-5.4"' "${STATE_DIR}/config/opencode.json"
if grep -Fq '"plugin"' "${STATE_DIR}/config/opencode.json"; then
  echo "tenant config should not inherit host plugins" >&2
  exit 1
fi
if grep -Fq '"mcp"' "${STATE_DIR}/config/opencode.json"; then
  echo "tenant config should not inherit host mcp settings" >&2
  exit 1
fi
test -f "${STATE_DIR}/skills/tg-cli/SKILL.md"
test -f "${STATE_DIR}/skills/embedding-strategies/SKILL.md"
grep -Fx -- "${STATE_DIR}:/state" "${DOCKER_ARGS_FILE}"
grep -Fx -- "-p" "${DOCKER_ARGS_FILE}"
grep -Fx -- "127.0.0.1:49601:4096" "${DOCKER_ARGS_FILE}"
if grep -Fq 'cliproxyapi' "${DOCKER_ARGS_FILE}"; then
  echo "launcher should not hardcode cliproxyapi config" >&2
  exit 1
fi

printf 'ok\n'
