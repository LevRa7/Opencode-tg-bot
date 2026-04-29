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
SYMLINK_WORKSPACE_DIR="${TMP_DIR}/workspace-symlink"
SYMLINK_STATE_DIR="${TMP_DIR}/state-symlink"
SYMLINK_HOME_DIR="${SYMLINK_WORKSPACE_DIR}/tenant-home"
SYMLINK_TARGET_DIR="${SYMLINK_WORKSPACE_DIR}/ssh-target"
SYMLINK_LOG="${TMP_DIR}/symlink-run.log"
SYMLINKED_HOME_REAL_DIR="${SYMLINK_WORKSPACE_DIR}/tenant-home-real"
SYMLINKED_HOME_LINK_DIR="${SYMLINK_WORKSPACE_DIR}/tenant-home-link"
SYMLINKED_HOME_LOG="${TMP_DIR}/home-symlink-run.log"
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
  "${SYMLINK_WORKSPACE_DIR}" \
  "${SYMLINK_HOME_DIR}" \
  "${SYMLINKED_HOME_REAL_DIR}" \
  "${SYMLINK_TARGET_DIR}" \
  "${SYMLINK_STATE_DIR}/cache" \
  "${SYMLINK_STATE_DIR}/config" \
  "${SYMLINK_STATE_DIR}/share" \
  "${SYMLINK_STATE_DIR}/xdg-state" \
  "${FAKE_BIN_DIR}"

ln -s "tenant-home-real" "${SYMLINKED_HOME_LINK_DIR}"

cat > "${FAKE_OPENCODE}" <<'EOF'
#!/usr/bin/env sh
set -eu

if [ ! -d "${HOME}/.ssh" ]; then
  echo "FAIL: expected ${HOME}/.ssh to exist before runtime starts" >&2
  exit 1
fi

ssh_mode="$(stat -c '%a' "${HOME}/.ssh")"
if [ "${ssh_mode}" != "700" ]; then
  echo "FAIL: expected ${HOME}/.ssh mode 700 before runtime starts, got ${ssh_mode}" >&2
  exit 1
fi

ssh-keygen -t ed25519 -N '' -f "${HOME}/.ssh/test_ed25519" >/dev/null

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
test -d "${WORKSPACE_DIR}/.ssh"
test -f "${WORKSPACE_DIR}/.ssh/test_ed25519"
test -f "${WORKSPACE_DIR}/.ssh/test_ed25519.pub"

if [[ "$(stat -c '%a' "${WORKSPACE_DIR}/.ssh")" != "700" ]]; then
  echo "FAIL: workspace ssh directory should keep mode 700" >&2
  stat -c '%a %n' "${WORKSPACE_DIR}/.ssh" >&2
  exit 1
fi

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

if [[ "$(stat -c '%u:%g' "${WORKSPACE_DIR}/.ssh/test_ed25519")" != "${HOST_UID}:${HOST_GID}" ]]; then
  echo "FAIL: generated ssh private key should be host-owned by ${HOST_UID}:${HOST_GID}" >&2
  stat -c '%u:%g %n' "${WORKSPACE_DIR}/.ssh/test_ed25519" >&2
  exit 1
fi

if [[ "$(stat -c '%u:%g' "${WORKSPACE_DIR}/.ssh/test_ed25519.pub")" != "${HOST_UID}:${HOST_GID}" ]]; then
  echo "FAIL: generated ssh public key should be host-owned by ${HOST_UID}:${HOST_GID}" >&2
  stat -c '%u:%g %n' "${WORKSPACE_DIR}/.ssh/test_ed25519.pub" >&2
  exit 1
fi

# Regression coverage: the privileged entrypoint must refuse a tenant-controlled
# ${HOME}/.ssh symlink instead of following it into another workspace path.
touch "${SYMLINK_TARGET_DIR}/.fixture-reachability-check"
ln -s "../ssh-target" "${SYMLINK_HOME_DIR}/.ssh"

if [[ "$(readlink "${SYMLINK_HOME_DIR}/.ssh" 2>/dev/null || true)" != "../ssh-target" ]]; then
  echo "FAIL: test fixture must expose a container-visible ssh symlink target" >&2
  readlink "${SYMLINK_HOME_DIR}/.ssh" >&2 || true
  exit 1
fi

if ! "${DOCKER_CMD}" run --rm \
  --entrypoint /bin/sh \
  -e HOME=/workspace/tenant-home \
  -v "${SYMLINK_WORKSPACE_DIR}:/workspace" \
  "${IMAGE}" \
  -lc 'test -L "${HOME}/.ssh" && test -f "${HOME}/.ssh/.fixture-reachability-check"'; then
  echo "FAIL: test fixture must prove the ssh symlink target is reachable inside the container" >&2
  exit 1
fi

if "${DOCKER_CMD}" run --rm \
  -e HOME=/workspace/tenant-home \
  -e XDG_CONFIG_HOME=/state/config \
  -e XDG_CACHE_HOME=/state/cache \
  -e XDG_STATE_HOME=/state/xdg-state \
  -e XDG_DATA_HOME=/state/share \
  -e GEMINI_MEDIA_UPSTREAM_BASE_URL=http://127.0.0.1:9 \
  -e GEMINI_MEDIA_UPSTREAM_API_KEY=test-secret \
  -e GEMINI_MEDIA_MODEL=test-model \
  -v "${SYMLINK_WORKSPACE_DIR}:/workspace" \
  -v "${SYMLINK_STATE_DIR}:/state" \
  -v "${FAKE_OPENCODE}:/usr/local/bin/opencode:ro" \
  "${IMAGE}" \
  serve --hostname 0.0.0.0 --port 4096 >"${SYMLINK_LOG}" 2>&1; then
  echo "FAIL: entrypoint should reject a symlinked \
${HOME}/.ssh path before runtime startup" >&2
  exit 1
fi

if ! grep -Fq 'refusing to use non-directory ssh path: /workspace/tenant-home/.ssh' "${SYMLINK_LOG}"; then
  echo "FAIL: expected startup failure to reject the tenant-home ssh symlink explicitly" >&2
  cat "${SYMLINK_LOG}" >&2
  exit 1
fi

if grep -Fq '[merge-agents]' "${SYMLINK_LOG}"; then
  echo "FAIL: merge-agents should not run before tenant HOME validation rejects startup" >&2
  cat "${SYMLINK_LOG}" >&2
  exit 1
fi

if [[ -e "${SYMLINK_TARGET_DIR}/test_ed25519" || -e "${SYMLINK_TARGET_DIR}/test_ed25519.pub" ]]; then
  echo "FAIL: entrypoint followed the tenant-controlled ssh symlink" >&2
  ls -l "${SYMLINK_TARGET_DIR}" >&2
  exit 1
fi

# Regression coverage: reject a symlinked ${HOME} before root prepares ${HOME}/.ssh,
# even when the tenant hides the link behind a trailing dot path component.
if "${DOCKER_CMD}" run --rm \
  -e HOME=/workspace/tenant-home-link/. \
  -e XDG_CONFIG_HOME=/state/config \
  -e XDG_CACHE_HOME=/state/cache \
  -e XDG_STATE_HOME=/state/xdg-state \
  -e XDG_DATA_HOME=/state/share \
  -e GEMINI_MEDIA_UPSTREAM_BASE_URL=http://127.0.0.1:9 \
  -e GEMINI_MEDIA_UPSTREAM_API_KEY=test-secret \
  -e GEMINI_MEDIA_MODEL=test-model \
  -v "${SYMLINK_WORKSPACE_DIR}:/workspace" \
  -v "${SYMLINK_STATE_DIR}:/state" \
  -v "${FAKE_OPENCODE}:/usr/local/bin/opencode:ro" \
  "${IMAGE}" \
  serve --hostname 0.0.0.0 --port 4096 >"${SYMLINKED_HOME_LOG}" 2>&1; then
  echo "FAIL: entrypoint should reject a symlinked HOME path before runtime startup" >&2
  exit 1
fi

if ! grep -Fq 'refusing to use symlinked home directory: /workspace/tenant-home-link/.' "${SYMLINKED_HOME_LOG}"; then
  echo "FAIL: expected startup failure to reject the symlinked HOME path explicitly" >&2
  cat "${SYMLINKED_HOME_LOG}" >&2
  exit 1
fi

if grep -Fq '[merge-agents]' "${SYMLINKED_HOME_LOG}"; then
  echo "FAIL: merge-agents should not run before symlinked HOME rejection" >&2
  cat "${SYMLINKED_HOME_LOG}" >&2
  exit 1
fi

if [[ -e "${SYMLINKED_HOME_REAL_DIR}/.ssh" ]]; then
  echo "FAIL: entrypoint created .ssh through the symlinked HOME target" >&2
  ls -la "${SYMLINKED_HOME_REAL_DIR}" >&2
  exit 1
fi

printf 'ok: entrypoint keeps tenant mounts writable without leaving proxy secrets on disk\n'
