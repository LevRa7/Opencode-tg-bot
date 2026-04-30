# Docker Tenant Python Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Python package installation work inside tenant Docker runtimes by bootstrapping a persistent tenant-local virtual environment under `/workspace` and making it the default `python`/`pip` context for tenant runtime commands.

**Architecture:** Keep the system interpreter in the image only as bootstrap infrastructure. Install `python3-pip` and `python3-venv` in `docker/Dockerfile`, add a focused shell helper that creates or repairs `/workspace/.venvs/default`, and call that helper from `docker/bin/docker-entrypoint.sh` before launching OpenCode. Cover the change with one image-level Python bootstrap test, one tenant runtime persistence/repair test, and wire the new test into `docker/update-opencode.sh` so the Docker rebuild workflow keeps enforcing the contract.

**Tech Stack:** Docker, Debian package management, POSIX shell, Bash-based Docker tests, Markdown documentation.

---

## File Map

- `docker/Dockerfile` - install Python bootstrap packages and copy the tenant Python bootstrap helper into the final image.
- `docker/bin/ensure-tenant-python-env.sh` - new helper that creates, repairs, and exports the default tenant-local Python environment.
- `docker/bin/docker-entrypoint.sh` - call the helper after the HOME safety checks so OpenCode inherits the tenant-local Python environment.
- `docker/tests/tg-cli-image.test.sh` - assert the image can create a Python virtual environment and exposes bootstrap Python tools.
- `docker/tests/tenant-python-env.test.sh` - new regression test for creation, reuse, and repair of `/workspace/.venvs/default`.
- `docker/tests/update-opencode-smoke.test.sh` - require `docker/update-opencode.sh` to run the new tenant Python environment test.
- `docker/update-opencode.sh` - run the new Docker regression test in both smoke mode and real rebuild mode.
- `docker/README.md` - document where tenant Python packages and caches now live.
- `docker/README-ru.md` - same Docker Python environment documentation in Russian.
- `CHANGELOG.md` - record the new tenant-local Python environment behavior.

---

### Task 1: Add Failing Docker Tests For Python Bootstrap And Tenant Persistence

**Files:**

- Modify: `docker/tests/tg-cli-image.test.sh`
- Create: `docker/tests/tenant-python-env.test.sh`
- Modify: `docker/tests/update-opencode-smoke.test.sh`

- [ ] **Step 1: Extend the image-level Docker test with Python bootstrap assertions**

```bash
# Replace docker/tests/tg-cli-image.test.sh with:
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
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode >/dev/null && version="$(opencode --version 2>&1)" && test -n "${version}"'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v ssh >/dev/null && command -v scp >/dev/null && command -v sftp >/dev/null && command -v ssh-keygen >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'ssh -V >/dev/null 2>&1'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v python3 >/dev/null && python3 -m pip --version >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'python3 -m venv /tmp/image-venv && /tmp/image-venv/bin/pip --version >/dev/null'
"${DOCKER_CMD}" run --rm \
  --entrypoint sh \
  -e TG_API_ID=123 \
  -e TG_API_HASH=abc \
  "${IMAGE}" \
  -lc 'command -v opencode-tg-cli >/dev/null && opencode-tg-cli --help >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode-gemini-media >/dev/null && test -f /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs && test -f /usr/local/bin/docker-entrypoint.sh'

printf 'ok: tg-cli, ssh, and Python bootstrap tools are present in the image\n'
```

- [ ] **Step 2: Run the image test to prove the current image is red on `python3 -m venv`**

Run: `bash docker/tests/tg-cli-image.test.sh`
Expected: FAIL with the Debian `ensurepip is not available` message that recommends installing `python3.11-venv` or `python3-venv`.

- [ ] **Step 3: Add a failing tenant runtime test for create/reuse/repair behavior**

```bash
# Create docker/tests/tenant-python-env.test.sh with:
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

cat >"${FIXTURE_DIR}/pyproject.toml" <<'EOF'
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "tenant-fixture"
version = "0.1.0"
description = "Local fixture package for tenant Python environment tests"

[tool.setuptools.packages.find]
where = ["src"]
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
    pip install "${HOME}/fixture-package" >/tmp/tenant-python-pip.log 2>&1 || {
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

  "${DOCKER_CMD}" run --rm \
    -e HOME=/workspace \
    -e XDG_CONFIG_HOME=/state/config \
    -e XDG_CACHE_HOME=/state/cache \
    -e XDG_STATE_HOME=/state/xdg-state \
    -e XDG_DATA_HOME=/state/share \
    -e PY_ENV_TEST_MODE="${mode}" \
    -v "${WORKSPACE_DIR}:/workspace" \
    -v "${STATE_DIR}:/state" \
    -v "${FAKE_OPENCODE}:/usr/local/bin/opencode:ro" \
    "${IMAGE}" \
    serve --hostname 0.0.0.0 --port 4096
}

run_container install
test -d "${WORKSPACE_DIR}/.venvs/default"
test -f "${WORKSPACE_DIR}/.python-env-install-ok"

run_container reuse
test -f "${WORKSPACE_DIR}/.python-env-reuse-ok"

rm -f \
  "${WORKSPACE_DIR}/.venvs/default/bin/pip" \
  "${WORKSPACE_DIR}/.venvs/default/bin/python" \
  "${WORKSPACE_DIR}/.venvs/default/bin/python3"

run_container repair
test -x "${WORKSPACE_DIR}/.venvs/default/bin/pip"
test -x "${WORKSPACE_DIR}/.venvs/default/bin/python"
test -f "${WORKSPACE_DIR}/.python-env-repair-ok"
test -f "${WORKSPACE_DIR}/keep-me.txt"

printf 'ok: tenant python env is created, reused, and repaired in /workspace\n'
```

- [ ] **Step 4: Run the new tenant runtime test to confirm it fails before the entrypoint change**

Run: `bash docker/tests/tenant-python-env.test.sh`
Expected: FAIL from the fake `opencode` binary with `expected tenant venv binaries in /workspace/.venvs/default/bin` because the current entrypoint does not create the tenant-local environment yet.

- [ ] **Step 5: Extend the update smoke contract so rebuild automation must run the new test**

```bash
# In docker/tests/update-opencode-smoke.test.sh, inside run_update_script_smoke(),
# replace the stub setup block with:
  write_stub_test_script "${fake_repo_root}/docker/tests/tg-cli-image.test.sh" "ran tg-cli-image.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-python-env.test.sh" "ran tenant-python-env.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-entrypoint-permissions.test.sh" "ran tenant-entrypoint-permissions.test.sh"
  write_git_stub "${fake_bin}/git"
  write_bash_stub "${fake_bin}/bash"

# Still in run_update_script_smoke(), add this assertion after the tg-cli image assertion:
  assert_log_contains "${calls_log}" "ran tenant-python-env.test.sh" "expected docker/tests/tenant-python-env.test.sh to run"

# In run_update_script_requires_remote_head(), replace the stub setup block with:
  write_stub_test_script "${fake_repo_root}/docker/tests/tg-cli-image.test.sh" "ran tg-cli-image.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-python-env.test.sh" "ran tenant-python-env.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-entrypoint-permissions.test.sh" "ran tenant-entrypoint-permissions.test.sh"
  write_git_stub "${fake_bin}/git" "no"
  write_bash_stub "${fake_bin}/bash"
```

- [ ] **Step 6: Run the smoke test and confirm the current update script is now red**

Run: `bash docker/tests/update-opencode-smoke.test.sh`
Expected: FAIL with `expected docker/tests/tenant-python-env.test.sh to run` because `docker/update-opencode.sh` does not invoke that new test yet.

- [ ] **Step 7: Commit the failing Docker test contract**

```bash
git add docker/tests/tg-cli-image.test.sh docker/tests/tenant-python-env.test.sh docker/tests/update-opencode-smoke.test.sh
git commit -m "test: define docker tenant python env contract"
```

---

### Task 2: Bootstrap And Repair The Tenant-Local Python Environment

**Files:**

- Create: `docker/bin/ensure-tenant-python-env.sh`
- Modify: `docker/Dockerfile`
- Modify: `docker/bin/docker-entrypoint.sh`

- [ ] **Step 1: Add a focused helper that creates or repairs `/workspace/.venvs/default`**

```sh
# Create docker/bin/ensure-tenant-python-env.sh with:
#!/bin/sh
set -eu

tenant_python_env_is_usable() {
  tenant_default_venv="$1"

  [ -x "${tenant_default_venv}/bin/python" ] \
    && [ -x "${tenant_default_venv}/bin/pip" ] \
    && "${tenant_default_venv}/bin/python" -m pip --version >/dev/null 2>&1
}

ensure_tenant_python_env() {
  tenant_home="${HOME}"
  tenant_venv_root="${tenant_home}/.venvs"
  tenant_default_venv="${tenant_venv_root}/default"
  tenant_local_bin="${tenant_home}/.local/bin"
  tenant_cache_root="${tenant_home}/.cache"
  tenant_pip_cache="${tenant_cache_root}/pip"
  wheels_dir="/usr/share/python-wheels"
  needs_bootstrap="0"

  mkdir -p "${tenant_venv_root}" "${tenant_local_bin}" "${tenant_pip_cache}"

  if [ -d "${tenant_default_venv}" ] && ! tenant_python_env_is_usable "${tenant_default_venv}"; then
    rm -rf "${tenant_default_venv}"
    needs_bootstrap="1"
  fi

  if [ ! -d "${tenant_default_venv}" ]; then
    python3 -m venv "${tenant_default_venv}"
    needs_bootstrap="1"
  fi

  if [ "${needs_bootstrap}" = "1" ] && [ -d "${wheels_dir}" ]; then
    "${tenant_default_venv}/bin/python" -m pip install \
      --no-index \
      --find-links "${wheels_dir}" \
      --upgrade pip setuptools wheel >/dev/null
  fi

  VIRTUAL_ENV="${tenant_default_venv}"
  PIP_CACHE_DIR="${tenant_pip_cache}"
  PATH="${tenant_default_venv}/bin:${tenant_local_bin}:${PATH}"
  export VIRTUAL_ENV PIP_CACHE_DIR PATH
}
```

- [ ] **Step 2: Install the Python bootstrap packages and copy the helper into the final image**

```Dockerfile
# Replace docker/Dockerfile with:
ARG TENANT_IMAGE=opencode-tenant:latest
FROM ${TENANT_IMAGE}

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 opencode || true \
  && useradd -m -u 1000 -g 1000 -s /bin/sh opencode || true

RUN groupadd -g 2000 opencode-proxy || true \
  && useradd -M -u 2000 -g 2000 -s /usr/sbin/nologin opencode-proxy || true

COPY vendor/python-tg-cli/src/tg_cli /opt/tg-cli/src/tg_cli
RUN cat > /usr/local/bin/tg <<'EOF'
#!/usr/bin/env sh
set -eu
export PYTHONPATH="/opt/tg-cli/src${PYTHONPATH:+:${PYTHONPATH}}"
exec python3 -c 'from tg_cli.cli.main import cli; cli(prog_name="tg")' "$@"
EOF
RUN chmod +x /usr/local/bin/tg \
  && ln -sf /usr/local/bin/tg /usr/local/bin/telegram-cli \
  && ln -sf /usr/local/bin/tg /usr/local/bin/tg-cli

COPY bin/tg-cli-wrapper.sh /usr/local/bin/opencode-tg-cli
RUN chmod +x /usr/local/bin/opencode-tg-cli

COPY bin/opencode-gemini-media /usr/local/bin/opencode-gemini-media
RUN chmod +x /usr/local/bin/opencode-gemini-media

COPY bin/gemini-media-proxy.mjs /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs

COPY bin/ensure-tenant-python-env.sh /usr/local/bin/ensure-tenant-python-env.sh
RUN chmod +x /usr/local/bin/ensure-tenant-python-env.sh

# Whisper STT batch transcription scripts
COPY batch-transcribe.sh /usr/local/bin/batch-transcribe
COPY batch-transcribe.mjs /usr/local/bin/batch-transcribe-node
RUN chmod +x /usr/local/bin/batch-transcribe /usr/local/bin/batch-transcribe-node

# Global AGENTS.md (baked into image, lower priority than user's volume-mounted version)
COPY AGENTS.md /etc/opencode-global/AGENTS.md

# AGENTS.md merge script
COPY bin/merge-agents.sh /usr/local/bin/merge-agents
RUN chmod +x /usr/local/bin/merge-agents

# Entrypoint wrapper: merge AGENTS.md then exec opencode
COPY bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

- [ ] **Step 3: Source the helper from the entrypoint before launching OpenCode**

```sh
# Replace docker/bin/docker-entrypoint.sh with:
#!/bin/sh
set -eu

merge-agents

home_path="${HOME}"

# 2026-04: Resolve HOME through the filesystem before using it so tenant-controlled
# paths like /workspace/home-link/. cannot hide a symlink that would redirect root.
resolved_home="$(CDPATH= cd -- "${home_path}" 2>/dev/null && pwd -P)" || {
  echo "refusing to use inaccessible home directory: ${home_path}" >&2
  exit 1
}
logical_home="$(CDPATH= cd -- "${home_path}" 2>/dev/null && pwd -L)" || {
  echo "refusing to use inaccessible home directory: ${home_path}" >&2
  exit 1
}

if [ -L "${home_path}" ] || [ "${logical_home}" != "${resolved_home}" ]; then
  echo "refusing to use symlinked home directory: ${home_path}" >&2
  exit 1
fi

HOME="${resolved_home}"
export HOME

if [ -L "${HOME}" ]; then
  echo "refusing to use symlinked home directory: ${HOME}" >&2
  exit 1
fi

tenant_ssh_dir="${HOME}/.ssh"

if [ -L "${tenant_ssh_dir}" ] || { [ -e "${tenant_ssh_dir}" ] && [ ! -d "${tenant_ssh_dir}" ]; }; then
  echo "refusing to use non-directory ssh path: ${tenant_ssh_dir}" >&2
  exit 1
fi

if [ ! -d "${tenant_ssh_dir}" ]; then
  mkdir -p "${tenant_ssh_dir}"
  chmod 700 "${tenant_ssh_dir}"
fi

. /usr/local/bin/ensure-tenant-python-env.sh
ensure_tenant_python_env

mkdir -p /run/opencode-gemini-media

# Fix permissions for cliproxyapi.key if it exists
if [ -f /workspace/.config/opencode/cliproxyapi.key ]; then
  echo "Found cliproxyapi.key, fixing permissions..."
  chmod 600 /workspace/.config/opencode/cliproxyapi.key
  ls -l /workspace/.config/opencode/cliproxyapi.key
else
  echo "WARNING: cliproxyapi.key not found at /workspace/.config/opencode/cliproxyapi.key"
fi

if [ -n "${GEMINI_MEDIA_UPSTREAM_BASE_URL:-}" ] && [ -n "${GEMINI_MEDIA_UPSTREAM_API_KEY:-}" ]; then
  umask 077
  cat > /run/opencode-gemini-media/config.json <<EOF
{"baseUrl":"${GEMINI_MEDIA_UPSTREAM_BASE_URL}","apiKey":"${GEMINI_MEDIA_UPSTREAM_API_KEY}","model":"${GEMINI_MEDIA_MODEL:-gemini-3.1-flash-lite-preview}"}
EOF
  chown 2000:2000 /run/opencode-gemini-media/config.json
  setpriv --reuid=2000 --regid=2000 --clear-groups --bounding-set=-all --nnp \
    node /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs &
fi

unset GEMINI_MEDIA_UPSTREAM_BASE_URL
unset GEMINI_MEDIA_UPSTREAM_API_KEY
unset GEMINI_MEDIA_MODEL

# Rootless Docker bind mounts expose the host user as container root, not uid 1000.
# Keep uid/gid 0 for writable /workspace and /state, but drop all capabilities and
# move the proxy config to a different owner so the tenant runtime still cannot read it.
exec setpriv --reuid=0 --regid=0 --clear-groups --bounding-set=-all --nnp opencode "$@"
```

- [ ] **Step 4: Rebuild the Docker image with the Python bootstrap helper included**

Run: `./docker/build-opencode-tg-image.sh`
Expected: PASS with `docker build` completing successfully and producing `opencode-tg:local`.

- [ ] **Step 5: Re-run the image-level Docker test and verify `python3 -m venv` now works**

Run: `bash docker/tests/tg-cli-image.test.sh`
Expected: PASS with `ok: tg-cli, ssh, and Python bootstrap tools are present in the image`.

- [ ] **Step 6: Re-run the tenant runtime test and verify create/reuse/repair all pass**

Run: `bash docker/tests/tenant-python-env.test.sh`
Expected: PASS with `ok: tenant python env is created, reused, and repaired in /workspace`.

- [ ] **Step 7: Commit the tenant Python bootstrap implementation**

```bash
git add docker/Dockerfile docker/bin/ensure-tenant-python-env.sh docker/bin/docker-entrypoint.sh
git commit -m "feat: bootstrap tenant python env in docker"
```

---

### Task 3: Wire The New Test Into Docker Rebuild Verification And Update Docs

**Files:**

- Modify: `docker/update-opencode.sh`
- Modify: `docker/README.md`
- Modify: `docker/README-ru.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Make the update workflow run the new tenant Python environment test**

```bash
# In docker/update-opencode.sh, replace run_verification() with:
run_verification() {
  local image_name="${1:-}"

  if [[ -n "${image_name}" ]]; then
    OPENCODE_DOCKER_IMAGE="${image_name}" bash "${SCRIPT_DIR}/tests/tg-cli-image.test.sh"
    OPENCODE_DOCKER_IMAGE="${image_name}" bash "${SCRIPT_DIR}/tests/tenant-python-env.test.sh"
    OPENCODE_DOCKER_IMAGE="${image_name}" bash "${SCRIPT_DIR}/tests/tenant-entrypoint-permissions.test.sh"
    return 0
  fi

  bash "${SCRIPT_DIR}/tests/tg-cli-image.test.sh"
  bash "${SCRIPT_DIR}/tests/tenant-python-env.test.sh"
  bash "${SCRIPT_DIR}/tests/tenant-entrypoint-permissions.test.sh"
}

# In the smoke-mode branch, replace:
    log "Smoke mode complete"
    bash "${SCRIPT_DIR}/tests/tg-cli-image.test.sh"
    bash "${SCRIPT_DIR}/tests/tenant-entrypoint-permissions.test.sh"
    return 0

# with:
    log "Smoke mode complete"
    run_verification
    return 0

# At the end of main(), replace:
  print_versions
  OPENCODE_DOCKER_IMAGE="${TG_IMAGE}" bash "${SCRIPT_DIR}/tests/tg-cli-image.test.sh"
  OPENCODE_DOCKER_IMAGE="${TG_IMAGE}" bash "${SCRIPT_DIR}/tests/tenant-entrypoint-permissions.test.sh"

# with:
  print_versions
  run_verification "${TG_IMAGE}"
```

- [ ] **Step 2: Re-run the update smoke contract and verify it turns green**

Run: `bash docker/tests/update-opencode-smoke.test.sh`
Expected: PASS with `ok: update-opencode script contract is present`.

- [ ] **Step 3: Document the tenant-local Python environment in English**

````markdown
# In docker/README.md, insert this section after "## Tenant SSH behavior":

## Tenant Python environment

The container now prepares a tenant-local Python virtual environment under:

```text
/workspace/.venvs/default
```

Practical consequences:

- commands launched by the tenant runtime resolve `python`, `python3`, and `pip` from `/workspace/.venvs/default/bin`
- Python packages installed with `pip install <package>` persist in the tenant workspace across container restarts
- the tenant pip cache lives under `/workspace/.cache/pip`
- if `/workspace/.venvs/default` is missing or broken, the entrypoint recreates it automatically before launching OpenCode

The system interpreter remains available for image maintenance, but normal tenant package installation should use the tenant-local environment above.
````

- [ ] **Step 4: Document the same tenant-local Python behavior in Russian**

````markdown
# In docker/README-ru.md, insert this section after "## Как работает tenant SSH":

## Tenant Python environment

Контейнер теперь подготавливает tenant-local Python virtual environment в:

```text
/workspace/.venvs/default
```

Практические последствия:

- команды tenant runtime используют `python`, `python3` и `pip` из `/workspace/.venvs/default/bin`
- Python-пакеты, установленные через `pip install <package>`, сохраняются в workspace этого tenant между перезапусками контейнера
- pip cache tenant находится в `/workspace/.cache/pip`
- если `/workspace/.venvs/default` отсутствует или поврежден, entrypoint автоматически пересоздает его перед запуском OpenCode

Системный interpreter остается доступным для обслуживания image, но штатная установка tenant-пакетов должна идти через tenant-local environment выше.
````

- [ ] **Step 5: Record the new Docker Python behavior in the changelog**

```markdown
# In CHANGELOG.md under "## [Unreleased]" -> "### Added", add:

- Added a tenant-local Python bootstrap flow for Docker runtimes that creates and repairs `/workspace/.venvs/default`, routes tenant `python`/`pip` commands there, and keeps installed packages persistent in the tenant workspace across container restarts.
  - Why: Docker tenants were hitting blocked system `pip` flows and missing `python3-venv`, which made ad-hoc Python package installation unreliable and often impossible to repair remotely.
  - Affects: `docker/Dockerfile`, `docker/bin/ensure-tenant-python-env.sh`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tg-cli-image.test.sh`, `docker/tests/tenant-python-env.test.sh`, `docker/update-opencode.sh`, `docker/README.md`, `docker/README-ru.md`
```

- [ ] **Step 6: Run the Docker regression suite plus the standard repository checks**

Run: `bash docker/tests/tg-cli-image.test.sh && bash docker/tests/tenant-python-env.test.sh && bash docker/tests/tenant-entrypoint-permissions.test.sh && bash docker/tests/update-opencode-smoke.test.sh && npm run build && npm run lint && npm test`
Expected: PASS with all four Docker tests green first, then the repository TypeScript build, lint, and test suite passing without new failures.

- [ ] **Step 7: Commit the verification wiring and documentation updates**

```bash
git add docker/update-opencode.sh docker/README.md docker/README-ru.md CHANGELOG.md
git commit -m "docs: document docker tenant python env"
```

---

### Task 4: Run Post-Implementation Review And Apply Any Small Follow-Up Fixes

**Files:**

- Review scope: `docker/Dockerfile`
- Review scope: `docker/bin/ensure-tenant-python-env.sh`
- Review scope: `docker/bin/docker-entrypoint.sh`
- Review scope: `docker/tests/tg-cli-image.test.sh`
- Review scope: `docker/tests/tenant-python-env.test.sh`
- Review scope: `docker/update-opencode.sh`

- [ ] **Step 1: Launch the security review in parallel with the architecture review**

```text
Security review prompt:

Review these changes for security issues only.

Focus on authn/authz, secrets handling, input validation, injection, SSRF, path traversal, unsafe deserialization, race conditions, logging leaks, privilege escalation, and remote-control abuse paths.
Pay extra attention to trust boundaries where the Telegram bot can trigger actions in local runtimes or external tools.

Context:
- Added tenant-local Python bootstrap support in the Docker runtime.
- The image now installs python3-pip and python3-venv.
- The entrypoint now creates or repairs /workspace/.venvs/default and exports it on PATH before launching OpenCode.
- Added Docker tests for image-level Python bootstrap support and tenant venv create/reuse/repair behavior.

Touched files:
- docker/Dockerfile
- docker/bin/ensure-tenant-python-env.sh
- docker/bin/docker-entrypoint.sh
- docker/tests/tg-cli-image.test.sh
- docker/tests/tenant-python-env.test.sh
- docker/tests/update-opencode-smoke.test.sh
- docker/update-opencode.sh

Verification already passed:
- bash docker/tests/tg-cli-image.test.sh
- bash docker/tests/tenant-python-env.test.sh
- bash docker/tests/tenant-entrypoint-permissions.test.sh
- bash docker/tests/update-opencode-smoke.test.sh
- npm run build
- npm run lint
- npm test

For each finding, report: severity, file:line, why it matters, exploitability, and the smallest safe fix.
If there are no findings, say so and mention any residual risk.
Do not suggest unrelated refactors.
```

```text
Architecture review prompt:

Review these changes for architecture and complexity quality.

Focus on coupling, cohesion, module boundaries, DDD bounded contexts, ubiquitous language, dependency direction, Clean Architecture layering, testability, observability, debuggability, scalability, and how hard it would be to replace one module with another.
Call out trade-offs, hotspots, hidden dependencies, and places where primitives leak across domain boundaries.

Context:
- Added tenant-local Python bootstrap support in the Docker runtime.
- The image now installs python3-pip and python3-venv.
- The entrypoint now creates or repairs /workspace/.venvs/default and exports it on PATH before launching OpenCode.
- Added Docker tests for image-level Python bootstrap support and tenant venv create/reuse/repair behavior.

Touched files:
- docker/Dockerfile
- docker/bin/ensure-tenant-python-env.sh
- docker/bin/docker-entrypoint.sh
- docker/tests/tg-cli-image.test.sh
- docker/tests/tenant-python-env.test.sh
- docker/tests/update-opencode-smoke.test.sh
- docker/update-opencode.sh

Verification already passed:
- bash docker/tests/tg-cli-image.test.sh
- bash docker/tests/tenant-python-env.test.sh
- bash docker/tests/tenant-entrypoint-permissions.test.sh
- bash docker/tests/update-opencode-smoke.test.sh
- npm run build
- npm run lint
- npm test

For each finding, report: severity, file:line, why it matters, and the smallest refactor that would improve the design.
Keep the focus on maintainability, not style.
```

- [ ] **Step 2: If either review finds a real issue, fix only the reported files and re-run the same verification command**

Run: `bash docker/tests/tg-cli-image.test.sh && bash docker/tests/tenant-python-env.test.sh && bash docker/tests/tenant-entrypoint-permissions.test.sh && bash docker/tests/update-opencode-smoke.test.sh && npm run build && npm run lint && npm test`
Expected: PASS again after the smallest safe follow-up fix.

- [ ] **Step 3: Commit the review-driven follow-up only if you had to change code after the reviews**

```bash
git add docker/Dockerfile docker/bin/ensure-tenant-python-env.sh docker/bin/docker-entrypoint.sh docker/tests/tg-cli-image.test.sh docker/tests/tenant-python-env.test.sh docker/tests/update-opencode-smoke.test.sh docker/update-opencode.sh docker/README.md docker/README-ru.md CHANGELOG.md
git commit -m "fix: tighten docker tenant python env bootstrap"
```
