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

WORKSPACE_DIR="${TMP_DIR}/workspace"
STATE_DIR="${TMP_DIR}/state"
FAKE_BIN_DIR="${TMP_DIR}/bin"
FAKE_OPENCODE="${FAKE_BIN_DIR}/opencode"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

mkdir -p \
  "${WORKSPACE_DIR}" \
  "${STATE_DIR}/cache" \
  "${STATE_DIR}/config" \
  "${STATE_DIR}/share" \
  "${STATE_DIR}/xdg-state" \
  "${FAKE_BIN_DIR}"

cat > "${FAKE_OPENCODE}" <<'EOF'
#!/usr/bin/env sh
set -eu

mkdir -p "${XDG_CACHE_HOME}/opencode"
touch "${HOME}/.perm-check"

if [ -f /run/opencode-gemini-media/config.json ]; then
  if cat /run/opencode-gemini-media/config.json >/dev/null 2>&1; then
    echo "FAIL: proxy config should not be readable by the tenant runtime" >&2
    exit 1
  fi

  proxy_pid=""
  for proc_dir in /proc/[0-9]*; do
    [ -r "${proc_dir}/cmdline" ] || continue
    cmdline="$(tr '\000' ' ' < "${proc_dir}/cmdline" 2>/dev/null || true)"
    case "${cmdline}" in
      *gemini-media-proxy.mjs*)
        proxy_pid="${proc_dir#/proc/}"
        break
        ;;
    esac
  done

  if [ -z "${proxy_pid}" ]; then
    echo "FAIL: expected gemini media proxy to be running" >&2
    exit 1
  fi

  proxy_uid="$(stat -c '%u' "/proc/${proxy_pid}")"
  if [ "${proxy_uid}" = "0" ]; then
    echo "FAIL: proxy process should not run as uid 0" >&2
    exit 1
  fi

  if cat "/proc/${proxy_pid}/environ" >/dev/null 2>&1; then
    echo "FAIL: tenant runtime should not read proxy process environment" >&2
    exit 1
  fi
fi
EOF

chmod +x "${FAKE_OPENCODE}"

"${DOCKER_CMD}" run --rm \
  -e HOME=/workspace \
  -e XDG_CONFIG_HOME=/state/config \
  -e XDG_CACHE_HOME=/state/cache \
  -e XDG_STATE_HOME=/state/xdg-state \
  -e XDG_DATA_HOME=/state/share \
  -e GEMINI_MEDIA_UPSTREAM_BASE_URL=http://127.0.0.1:9 \
  -e GEMINI_MEDIA_UPSTREAM_API_KEY=test-secret \
  -e GEMINI_MEDIA_MODEL=test-model \
  -v "${WORKSPACE_DIR}:/workspace" \
  -v "${STATE_DIR}:/state" \
  -v "${FAKE_OPENCODE}:/usr/local/bin/opencode:ro" \
  "${IMAGE}" \
  serve --hostname 0.0.0.0 --port 4096

test -d "${STATE_DIR}/cache/opencode"
test -f "${WORKSPACE_DIR}/.perm-check"

if [[ "$(stat -c '%u:%g' "${STATE_DIR}/cache/opencode")" != "${HOST_UID}:${HOST_GID}" ]]; then
  echo "FAIL: state cache directory should be host-owned by ${HOST_UID}:${HOST_GID}" >&2
  stat -c '%u:%g %n' "${STATE_DIR}/cache/opencode" >&2
  exit 1
fi

if [[ "$(stat -c '%u:%g' "${WORKSPACE_DIR}/.perm-check")" != "${HOST_UID}:${HOST_GID}" ]]; then
  echo "FAIL: workspace files should be host-owned by ${HOST_UID}:${HOST_GID}" >&2
  stat -c '%u:%g %n' "${WORKSPACE_DIR}/.perm-check" >&2
  exit 1
fi

printf 'ok: entrypoint keeps tenant mounts writable without leaving proxy secrets on disk\n'
