#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TARGET_SCRIPT="${SCRIPT_DIR}/../stop-opencode-containers.sh"
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

FAKE_BIN="${TMP_DIR}/bin"
FAKE_RUNTIME_DIR="${TMP_DIR}/runtime"
DOCKER_ENV_FILE="${TMP_DIR}/docker-env.txt"
DOCKER_RM_FILE="${TMP_DIR}/docker-rm.txt"
SOCKET_PATH="${FAKE_RUNTIME_DIR}/docker.sock"

mkdir -p "${FAKE_BIN}" "${FAKE_RUNTIME_DIR}"

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

if [[ "$1" == "ps" ]]; then
  printf 'container-1\ncontainer-2\n'
  exit 0
fi

if [[ "$1" == "rm" && "$2" == "-f" ]]; then
  printf 'rm\t%s\t%s\t%s\n' "${DOCKER_CONFIG:-}" "${DOCKER_HOST:-}" "$3" >> "${DOCKER_RM_FILE}"
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 1
EOF

chmod +x "${FAKE_BIN}/docker"

export PATH="${FAKE_BIN}:${PATH}"
export XDG_RUNTIME_DIR="${FAKE_RUNTIME_DIR}"
export DOCKER_ENV_FILE
export DOCKER_RM_FILE
unset DOCKER_HOST
unset DOCKER_CONFIG

bash "${TARGET_SCRIPT}" >/dev/null

EXPECTED_DOCKER_CONFIG="${DOCKER_ROOT}/.docker-config"
EXPECTED_DOCKER_HOST="unix://${SOCKET_PATH}"

grep -Fx -- $'version\t'"${EXPECTED_DOCKER_CONFIG}"$'\t'"${EXPECTED_DOCKER_HOST}" "${DOCKER_ENV_FILE}"
grep -Fx -- $'rm\t'"${EXPECTED_DOCKER_CONFIG}"$'\t'"${EXPECTED_DOCKER_HOST}"$'\tcontainer-1' "${DOCKER_RM_FILE}"
grep -Fx -- $'rm\t'"${EXPECTED_DOCKER_CONFIG}"$'\t'"${EXPECTED_DOCKER_HOST}"$'\tcontainer-2' "${DOCKER_RM_FILE}"

printf 'ok\n'
