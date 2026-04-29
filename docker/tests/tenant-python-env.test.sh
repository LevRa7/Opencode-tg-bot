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
FIXTURE_DIR="${WORKSPACE_DIR}/fixture-package"

mkdir -p \
  "${WORKSPACE_DIR}" \
  "${STATE_DIR}/cache" \
  "${STATE_DIR}/config" \
  "${STATE_DIR}/share" \
  "${STATE_DIR}/xdg-state" \
  "${FAKE_BIN_DIR}" \
  "${FIXTURE_DIR}/src/tenant_fixture"

cat >"${FIXTURE_DIR}/setup.py" <<'EOF'
from setuptools import setup

setup(
    name="tenant-fixture",
    version="0.1.0",
    description="Local fixture package for tenant Python environment tests",
    package_dir={"": "src"},
    packages=["tenant_fixture"],
)
EOF

cat >"${FIXTURE_DIR}/src/tenant_fixture/__init__.py" <<'EOF'
VALUE = "tenant-package-ok"
EOF

printf '%s\n' 'keep-me' >"${WORKSPACE_DIR}/keep-me.txt"

cat >"${FAKE_OPENCODE}" <<'EOF'
#!/usr/bin/env sh
set -eu

expected_venv="${HOME}/.venvs/default"
expected_python="${expected_venv}/bin/python"
expected_python3="${expected_venv}/bin/python3"
expected_pip="${expected_venv}/bin/pip"
mode="${PY_ENV_TEST_MODE:?missing PY_ENV_TEST_MODE}"

if [ ! -x "${expected_python}" ] || [ ! -x "${expected_pip}" ]; then
  echo "FAIL: expected tenant venv binaries in ${expected_venv}/bin" >&2
  exit 1
fi

if [ "$(command -v python)" != "${expected_python}" ]; then
  echo "FAIL: expected python to resolve to ${expected_python}" >&2
  command -v python >&2 || true
  exit 1
fi

if [ "$(command -v python3)" != "${expected_python3}" ]; then
  echo "FAIL: expected python3 to resolve to ${expected_python3}" >&2
  command -v python3 >&2 || true
  exit 1
fi

if [ "$(command -v pip)" != "${expected_pip}" ]; then
  echo "FAIL: expected pip to resolve to ${expected_pip}" >&2
  command -v pip >&2 || true
  exit 1
fi

if [ "${PIP_CACHE_DIR:-}" != "${HOME}/.cache/pip" ]; then
  echo "FAIL: expected PIP_CACHE_DIR=${HOME}/.cache/pip, got ${PIP_CACHE_DIR:-<unset>}" >&2
  exit 1
fi

if [ ! -d "${HOME}/.local/bin" ]; then
  echo "FAIL: expected ${HOME}/.local/bin to exist" >&2
  exit 1
fi

python - <<'PY'
import os
import sys

expected = os.path.join(os.environ["HOME"], ".venvs", "default")
if sys.prefix != expected:
    raise SystemExit(f"FAIL: expected sys.prefix={expected}, got {sys.prefix}")
PY

case "${mode}" in
  install|repair)
    pip install --no-deps --no-build-isolation --no-index --no-use-pep517 "${HOME}/fixture-package" >/tmp/tenant-python-pip.log 2>&1 || {
      cat /tmp/tenant-python-pip.log >&2
      exit 1
    }
    python - <<'PY'
from tenant_fixture import VALUE

if VALUE != "tenant-package-ok":
    raise SystemExit("FAIL: expected fixture package import to succeed")
PY
    ;;
  reuse)
    python - <<'PY'
from tenant_fixture import VALUE

if VALUE != "tenant-package-ok":
    raise SystemExit("FAIL: expected fixture package to remain installed across restart")
PY
    ;;
  *)
    echo "FAIL: unknown PY_ENV_TEST_MODE=${mode}" >&2
    exit 1
    ;;
esac

if [ "${mode}" = "repair" ] && [ ! -f "${HOME}/keep-me.txt" ]; then
  echo "FAIL: repairing the tenant venv must not remove unrelated workspace files" >&2
  exit 1
fi

mkdir -p "${XDG_CACHE_HOME}/opencode"
touch "${HOME}/.python-env-${mode}-ok"
EOF

chmod +x "${FAKE_OPENCODE}"

run_container() {
  local mode="$1"

  run_container_for_home "${mode}" "${WORKSPACE_DIR}" "${STATE_DIR}" "/workspace"
}

run_container_for_home() {
  local mode="$1"
  local workspace_dir="$2"
  local state_dir="$3"
  local home_path="$4"

  "${DOCKER_CMD}" run --rm \
    -e HOME="${home_path}" \
    -e XDG_CONFIG_HOME=/state/config \
    -e XDG_CACHE_HOME=/state/cache \
    -e XDG_STATE_HOME=/state/xdg-state \
    -e XDG_DATA_HOME=/state/share \
    -e PY_ENV_TEST_MODE="${mode}" \
    -v "${workspace_dir}:/workspace" \
    -v "${state_dir}:/state" \
    -v "${FAKE_OPENCODE}:/usr/local/bin/opencode:ro" \
    "${IMAGE}" \
    serve --hostname 0.0.0.0 --port 4096
}

assert_startup_rejects_path() {
  local mode="$1"
  local workspace_dir="$2"
  local state_dir="$3"
  local home_path="$4"
  local expected_message="$5"
  local log_file="$6"

  if run_container_for_home "${mode}" "${workspace_dir}" "${state_dir}" "${home_path}" >"${log_file}" 2>&1; then
    echo "FAIL: entrypoint should reject unsafe tenant path before runtime startup" >&2
    exit 1
  fi

  if ! grep -Fq "${expected_message}" "${log_file}"; then
    echo "FAIL: expected startup failure to mention ${expected_message}" >&2
    cat "${log_file}" >&2
    exit 1
  fi
}

run_container install
test -d "${WORKSPACE_DIR}/.venvs/default"
test -f "${WORKSPACE_DIR}/.python-env-install-ok"

run_container reuse
test -f "${WORKSPACE_DIR}/.python-env-reuse-ok"

cat >"${WORKSPACE_DIR}/.venvs/default/bin/mkdir" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "mkdir:$*:$(id -u)" >>"${HOME}/.root-path-shadow-executed"
exec /usr/bin/mkdir "$@"
EOF

chmod +x "${WORKSPACE_DIR}/.venvs/default/bin/mkdir"

run_container reuse

if grep -Fq 'mkdir:-p /run/opencode-gemini-media:0' "${WORKSPACE_DIR}/.root-path-shadow-executed" 2>/dev/null; then
  echo "FAIL: privileged preflight executed tenant-shadowed mkdir from PATH" >&2
  cat "${WORKSPACE_DIR}/.root-path-shadow-executed" >&2
  exit 1
fi

rm -f \
  "${WORKSPACE_DIR}/.venvs/default/bin/mkdir" \
  "${WORKSPACE_DIR}/.root-path-shadow-executed"

python3 - <<'PY' "${WORKSPACE_DIR}/.venvs/default/bin/pip"
from pathlib import Path
import sys

pip_path = Path(sys.argv[1])
contents = pip_path.read_text(encoding="utf-8")
lines = contents.splitlines()
lines[0] = "#!/workspace/.venvs/default/bin/python"
pip_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

run_container reuse
test -x "${WORKSPACE_DIR}/.venvs/default/bin/pip"
test -x "${WORKSPACE_DIR}/.venvs/default/bin/python"
test -x "${WORKSPACE_DIR}/.venvs/default/bin/python3"
test -f "${WORKSPACE_DIR}/.python-env-reuse-ok"
test "$(python3 - <<'PY' "${WORKSPACE_DIR}/.venvs/default/bin/pip"
from pathlib import Path
import sys

print(Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()[0])
PY
)" = "#!/workspace/.venvs/default/bin/python"
rm -f "${WORKSPACE_DIR}/.python-env-reuse-ok"

rm -f \
  "${WORKSPACE_DIR}/.venvs/default/bin/pip" \
  "${WORKSPACE_DIR}/.venvs/default/bin/python" \
  "${WORKSPACE_DIR}/.venvs/default/bin/python3"

run_container repair
test -x "${WORKSPACE_DIR}/.venvs/default/bin/pip"
test -x "${WORKSPACE_DIR}/.venvs/default/bin/python"
test -x "${WORKSPACE_DIR}/.venvs/default/bin/python3"
test -f "${WORKSPACE_DIR}/.python-env-repair-ok"
test -f "${WORKSPACE_DIR}/keep-me.txt"

rm -f "${WORKSPACE_DIR}/.python-env-repair-ok"
rm -rf "${WORKSPACE_DIR}/.venvs/default"
mkdir -p "${WORKSPACE_DIR}/.venvs/default/bin"

# 2026-04 security regression: root must never execute tenant-controlled binaries
# from ${HOME}/.venvs/default/bin while validating the workspace venv.
cat >"${WORKSPACE_DIR}/.venvs/default/bin/python" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "python:$*:$(id -u)" >>"${HOME}/.root-preflight-executed"
case "$*" in
  '-m pip --version')
    printf '%s\n' "pip 24.0 from ${HOME}/.venvs/default/lib/python3.11/site-packages/pip (python 3.11)"
    exit 0
    ;;
esac
exit 99
EOF

cat >"${WORKSPACE_DIR}/.venvs/default/bin/python3" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "python3:$*:$(id -u)" >>"${HOME}/.root-preflight-executed"
case "$*" in
  '-m pip --version')
    printf '%s\n' "pip 24.0 from ${HOME}/.venvs/default/lib/python3.11/site-packages/pip (python 3.11)"
    exit 0
    ;;
esac
exit 99
EOF

cat >"${WORKSPACE_DIR}/.venvs/default/bin/pip" <<'EOF'
#!/workspace/.venvs/default/bin/python3
printf '%s\n' "pip:$*:$(id -u)" >>"${HOME}/.root-preflight-executed"
if [ "$*" = '--version' ]; then
  printf '%s\n' "pip 24.0 from ${HOME}/.venvs/default/lib/python3.11/site-packages/pip (python 3.11)"
  exit 0
fi
exit 99
EOF

chmod +x \
  "${WORKSPACE_DIR}/.venvs/default/bin/python" \
  "${WORKSPACE_DIR}/.venvs/default/bin/python3" \
  "${WORKSPACE_DIR}/.venvs/default/bin/pip"

run_container repair
test -f "${WORKSPACE_DIR}/.python-env-repair-ok"

if [ -f "${WORKSPACE_DIR}/.root-preflight-executed" ]; then
  echo "FAIL: privileged preflight executed tenant-controlled venv binaries" >&2
  cat "${WORKSPACE_DIR}/.root-preflight-executed" >&2
  exit 1
fi

VENV_ROOT_WORKSPACE_DIR="${TMP_DIR}/workspace-venv-root-check"
VENV_ROOT_STATE_DIR="${TMP_DIR}/state-venv-root-check"
CACHE_ROOT_WORKSPACE_DIR="${TMP_DIR}/workspace-cache-root-check"
CACHE_ROOT_STATE_DIR="${TMP_DIR}/state-cache-root-check"
LOCAL_ROOT_WORKSPACE_DIR="${TMP_DIR}/workspace-local-root-check"
LOCAL_ROOT_STATE_DIR="${TMP_DIR}/state-local-root-check"

mkdir -p \
  "${VENV_ROOT_WORKSPACE_DIR}/venv-root-target" \
  "${VENV_ROOT_STATE_DIR}/cache" \
  "${VENV_ROOT_STATE_DIR}/config" \
  "${VENV_ROOT_STATE_DIR}/share" \
  "${VENV_ROOT_STATE_DIR}/xdg-state" \
  "${CACHE_ROOT_WORKSPACE_DIR}" \
  "${CACHE_ROOT_STATE_DIR}/cache" \
  "${CACHE_ROOT_STATE_DIR}/config" \
  "${CACHE_ROOT_STATE_DIR}/share" \
  "${CACHE_ROOT_STATE_DIR}/xdg-state" \
  "${LOCAL_ROOT_WORKSPACE_DIR}/local-root-target" \
  "${LOCAL_ROOT_STATE_DIR}/cache" \
  "${LOCAL_ROOT_STATE_DIR}/config" \
  "${LOCAL_ROOT_STATE_DIR}/share" \
  "${LOCAL_ROOT_STATE_DIR}/xdg-state"

ln -s "venv-root-target" "${VENV_ROOT_WORKSPACE_DIR}/.venvs"
printf '%s\n' 'not-a-directory' >"${CACHE_ROOT_WORKSPACE_DIR}/.cache"
ln -s "local-root-target" "${LOCAL_ROOT_WORKSPACE_DIR}/.local"

assert_startup_rejects_path \
  repair \
  "${VENV_ROOT_WORKSPACE_DIR}" \
  "${VENV_ROOT_STATE_DIR}" \
  /workspace \
  'refusing to use non-directory tenant venv root: /workspace/.venvs' \
  "${TMP_DIR}/venv-root-check.log"

assert_startup_rejects_path \
  repair \
  "${CACHE_ROOT_WORKSPACE_DIR}" \
  "${CACHE_ROOT_STATE_DIR}" \
  /workspace \
  'refusing to use non-directory tenant cache root: /workspace/.cache' \
  "${TMP_DIR}/cache-root-check.log"

assert_startup_rejects_path \
  repair \
  "${LOCAL_ROOT_WORKSPACE_DIR}" \
  "${LOCAL_ROOT_STATE_DIR}" \
  /workspace \
  'refusing to use non-directory tenant local root: /workspace/.local' \
  "${TMP_DIR}/local-root-check.log"

printf 'ok: tenant python env is created, reused, and repaired in /workspace\n'
