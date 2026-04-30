# Docker SSH Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ssh` available inside every tenant Docker runtime and ensure SSH keys created in the container land in that tenant's own `/workspace/.ssh` directory.

**Architecture:** Extend the Debian-based tenant image with the `openssh-client` package so `ssh`, `scp`, `sftp`, and `ssh-keygen` are always present. Keep tenant isolation unchanged by preparing `/workspace/.ssh` in the container entrypoint, relying on the existing `HOME=/workspace` contract so generated keys and SSH state stay inside the user's mounted workspace.

**Tech Stack:** Docker, Debian 12 package management, POSIX shell entrypoint scripts, Bash-based Docker image tests, Markdown documentation.

---

## File Map

- `docker/Dockerfile` - install `openssh-client` into the tenant-facing image.
- `docker/bin/docker-entrypoint.sh` - create `/workspace/.ssh` with restrictive permissions before launching OpenCode.
- `docker/tests/tg-cli-image.test.sh` - assert the built image exposes SSH client binaries.
- `docker/tests/tenant-entrypoint-permissions.test.sh` - assert the tenant runtime prepares `/workspace/.ssh` and that `ssh-keygen` writes keys there.
- `docker/README.md` - document the new SSH client behavior for English-speaking operators.
- `docker/README-ru.md` - document the same behavior in Russian.
- `CHANGELOG.md` - record the Docker runtime capability change.

---

### Task 1: Add Failing Image Tests And Install OpenSSH Client

**Files:**

- Modify: `docker/tests/tg-cli-image.test.sh`
- Modify: `docker/Dockerfile`

- [ ] **Step 1: Write the failing image-level SSH availability test first**

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

"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc '
  command -v tg >/dev/null &&
  command -v telegram-cli >/dev/null &&
  command -v tg-cli >/dev/null &&
  command -v ssh >/dev/null &&
  command -v scp >/dev/null &&
  command -v sftp >/dev/null &&
  command -v ssh-keygen >/dev/null
'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'tg --help >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'ssh -V >/dev/null 2>&1'
"${DOCKER_CMD}" run --rm \
  --entrypoint sh \
  -e TG_API_ID=123 \
  -e TG_API_HASH=abc \
  "${IMAGE}" \
  -lc 'command -v opencode-tg-cli >/dev/null && opencode-tg-cli --help >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode-gemini-media >/dev/null && test -f /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs && test -f /usr/local/bin/docker-entrypoint.sh'

printf 'ok: tg-cli and ssh client tools are present in the image\n'
```

- [ ] **Step 2: Run the image test to verify it fails before the Dockerfile change**

Run: `bash docker/tests/tg-cli-image.test.sh`
Expected: FAIL from the first container probe because `command -v ssh` exits non-zero.

- [ ] **Step 3: Install the OpenSSH client package in the tenant image**

```Dockerfile
# Replace docker/Dockerfile with:
ARG TENANT_IMAGE=opencode-tenant:latest
FROM ${TENANT_IMAGE}

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client \
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

- [ ] **Step 4: Rebuild the Docker image with the new package installed**

Run: `./docker/build-opencode-tg-image.sh`
Expected: PASS with `docker build` completing successfully and producing `opencode-tg:local`.

- [ ] **Step 5: Run the image test again to verify the SSH binaries are now present**

Run: `bash docker/tests/tg-cli-image.test.sh`
Expected: PASS with `ok: tg-cli and ssh client tools are present in the image`.

- [ ] **Step 6: Commit the image-level SSH client change**

```bash
git add docker/Dockerfile docker/tests/tg-cli-image.test.sh
git commit -m "feat: add ssh client to docker image"
```

---

### Task 2: Prepare Tenant SSH Home And Prove Keys Stay In The Workspace

**Files:**

- Modify: `docker/tests/tenant-entrypoint-permissions.test.sh`
- Modify: `docker/bin/docker-entrypoint.sh`

- [ ] **Step 1: Write the failing tenant runtime test first**

```bash
# Replace docker/tests/tenant-entrypoint-permissions.test.sh with:
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

if [ ! -d "${HOME}/.ssh" ]; then
  echo "FAIL: expected ${HOME}/.ssh to exist before tenant runtime starts" >&2
  exit 1
fi

ssh_dir_mode="$(stat -c '%a' "${HOME}/.ssh")"
if [ "${ssh_dir_mode}" != "700" ]; then
  echo "FAIL: expected ${HOME}/.ssh to have mode 700, got ${ssh_dir_mode}" >&2
  exit 1
fi

ssh-keygen -t ed25519 -N '' -f "${HOME}/.ssh/test_ed25519" >/dev/null

if [ ! -f "${HOME}/.ssh/test_ed25519" ] || [ ! -f "${HOME}/.ssh/test_ed25519.pub" ]; then
  echo "FAIL: ssh-keygen did not create key files in ${HOME}/.ssh" >&2
  exit 1
fi

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
test -d "${WORKSPACE_DIR}/.ssh"
test -f "${WORKSPACE_DIR}/.ssh/test_ed25519"
test -f "${WORKSPACE_DIR}/.ssh/test_ed25519.pub"
test -f "${WORKSPACE_DIR}/.perm-check"

if [[ "$(stat -c '%a' "${WORKSPACE_DIR}/.ssh")" != "700" ]]; then
  echo "FAIL: workspace .ssh directory should have mode 700" >&2
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
  echo "FAIL: generated private key should be host-owned by ${HOST_UID}:${HOST_GID}" >&2
  stat -c '%u:%g %n' "${WORKSPACE_DIR}/.ssh/test_ed25519" >&2
  exit 1
fi

printf 'ok: entrypoint prepares tenant ssh home and keeps mounts writable\n'
```

- [ ] **Step 2: Run the tenant runtime test to verify it fails before the entrypoint change**

Run: `bash docker/tests/tenant-entrypoint-permissions.test.sh`
Expected: FAIL with `expected /workspace/.ssh to exist before tenant runtime starts`.

- [ ] **Step 3: Prepare the tenant-local SSH directory in the entrypoint**

```sh
# Replace docker/bin/docker-entrypoint.sh with:
#!/bin/sh
set -eu

merge-agents

mkdir -p /run/opencode-gemini-media
mkdir -p /workspace/.ssh
chmod 700 /workspace/.ssh

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

- [ ] **Step 4: Rebuild the Docker image with the updated entrypoint**

Run: `./docker/build-opencode-tg-image.sh`
Expected: PASS with a rebuilt `opencode-tg:local` image.

- [ ] **Step 5: Run the tenant runtime test again to verify `.ssh` preparation and key generation now work**

Run: `bash docker/tests/tenant-entrypoint-permissions.test.sh`
Expected: PASS with `ok: entrypoint prepares tenant ssh home and keeps mounts writable`.

- [ ] **Step 6: Commit the tenant SSH home preparation change**

```bash
git add docker/bin/docker-entrypoint.sh docker/tests/tenant-entrypoint-permissions.test.sh
git commit -m "fix: prepare tenant ssh home on startup"
```

---

### Task 3: Document Tenant SSH Behavior And Record The Change

**Files:**

- Modify: `docker/README.md`
- Modify: `docker/README-ru.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the English Docker README with SSH client behavior**

````markdown
# In docker/README.md, add one feature bullet near the top list:

- OpenSSH client tools (`ssh`, `scp`, `sftp`, `ssh-keygen`) available inside the same container

# Then add this new section after "Build the Docker image from local artifacts":

## SSH client inside the tenant workspace

The image includes OpenSSH client tools:

- `ssh`
- `scp`
- `sftp`
- `ssh-keygen`

Each tenant container already runs with:

```text
HOME=/workspace
```
````

So the default SSH home becomes:

```text
/workspace/.ssh
```

That means:

- keys generated inside the container stay in that tenant's own workspace
- tenant-specific SSH config should live in `/workspace/.ssh/config`
- tenant-specific host fingerprints should live in `/workspace/.ssh/known_hosts`

Example:

```bash
ssh-keygen -t ed25519
ssh user@example.com
```

If the user already has a private key for that tenant, place it under `/workspace/.ssh/` or pass it explicitly with `ssh -i /workspace/.ssh/<key> user@example.com`.

````

- [ ] **Step 2: Update the Russian Docker README with the same tenant SSH guidance**

```markdown
# In docker/README-ru.md, add one feature bullet near the top list:
- OpenSSH client tools (`ssh`, `scp`, `sftp`, `ssh-keygen`) внутри того же контейнера

# Then add this new section after "Сборка Docker image из локальных артефактов":
## SSH client внутри tenant workspace

Образ включает OpenSSH client tools:

- `ssh`
- `scp`
- `sftp`
- `ssh-keygen`

Каждый tenant container уже запускается с:

```text
HOME=/workspace
````

Поэтому стандартная SSH-директория становится такой:

```text
/workspace/.ssh
```

Это означает:

- ключи, сгенерированные внутри контейнера, остаются в workspace этого tenant
- tenant-specific SSH config должен храниться в `/workspace/.ssh/config`
- tenant-specific host fingerprints должны храниться в `/workspace/.ssh/known_hosts`

Пример:

```bash
ssh-keygen -t ed25519
ssh user@example.com
```

Если у пользователя уже есть приватный ключ для этого tenant, положите его в `/workspace/.ssh/` или передайте явно через `ssh -i /workspace/.ssh/<key> user@example.com`.

````

- [ ] **Step 3: Record the Docker SSH capability in the changelog**

```markdown
# In CHANGELOG.md under ## [Unreleased] -> ### Added, insert:
- Added OpenSSH client tools to the Docker tenant image and prepared `/workspace/.ssh` on container startup so each isolated tenant can run `ssh` and generate keys that stay inside its own workspace.
  - Why: models running inside per-user Docker runtimes need outbound SSH access without leaking keys across tenants or depending on host-level SSH mounts.
  - Affects: `docker/Dockerfile`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tg-cli-image.test.sh`, `docker/tests/tenant-entrypoint-permissions.test.sh`, `docker/README.md`, `docker/README-ru.md`
````

- [ ] **Step 4: Commit the documentation and changelog updates**

```bash
git add docker/README.md docker/README-ru.md CHANGELOG.md
git commit -m "docs: describe docker ssh client support"
```

---

### Task 4: Run Final Verification For The Docker SSH Flow

**Files:**

- Modify: none
- Test: `docker/tests/tg-cli-image.test.sh`
- Test: `docker/tests/tenant-entrypoint-permissions.test.sh`

- [ ] **Step 1: Rebuild the Docker image one final time from the completed source tree**

Run: `./docker/build-opencode-tg-image.sh`
Expected: PASS with the final `opencode-tg:local` image built from the checked-in Dockerfile and entrypoint.

- [ ] **Step 2: Run the image-level Docker SSH test**

Run: `bash docker/tests/tg-cli-image.test.sh`
Expected: PASS with `ok: tg-cli and ssh client tools are present in the image`.

- [ ] **Step 3: Run the tenant runtime SSH-home test**

Run: `bash docker/tests/tenant-entrypoint-permissions.test.sh`
Expected: PASS with `ok: entrypoint prepares tenant ssh home and keeps mounts writable`.

- [ ] **Step 4: Run the repository build check required by project workflow**

Run: `npm run build`
Expected: PASS with the TypeScript project building successfully.

- [ ] **Step 5: Run the repository lint check required by project workflow**

Run: `npm run lint`
Expected: PASS with no lint errors.

- [ ] **Step 6: Run the repository test suite required by project workflow**

Run: `npm test`
Expected: PASS with the existing automated test suite green, including the Docker-related shell test coverage added above.

---

## Self-Review

- Spec coverage: Task 1 covers SSH binary availability, Task 2 covers `/workspace/.ssh` creation and tenant-local key generation, Task 3 covers operator documentation and changelog, and Task 4 covers rebuild plus verification commands from the spec and repo workflow.
- Placeholder scan: no `TODO`, `TBD`, or implicit "write tests later" steps remain; each task includes exact file paths, code, commands, and expected results.
- Type and path consistency: the plan consistently uses `openssh-client`, `/workspace/.ssh`, `docker/tests/tg-cli-image.test.sh`, and `docker/tests/tenant-entrypoint-permissions.test.sh` across all tasks.
