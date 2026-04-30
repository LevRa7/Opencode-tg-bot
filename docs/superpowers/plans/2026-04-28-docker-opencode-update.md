# Docker OpenCode Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `docker/update-opencode.sh` so one command refreshes upstream OpenCode from GitHub, rebuilds `opencode-tenant:local`, rebuilds `opencode-tg:local`, and proves the current Docker permission model still holds.

**Architecture:** Keep the existing two-image runtime (`opencode-tenant:local` -> `opencode-tg:local`) and add one orchestration script under `docker/` that prepares a local upstream checkout and artifacts, calls the tenant rebuild path, then reuses `docker/build-opencode-tg-image.sh` for the final image. Preserve the existing launcher, entrypoint, and mount contract by verifying versions and re-running the Docker permission tests after every rebuild.

**Tech Stack:** Bash, git, GitHub source checkout, Docker, existing Docker helper scripts, Markdown documentation.

---

## File Map

- `docker/update-opencode.sh` - new orchestration entry point that fetches upstream OpenCode, builds the local artifact, rebuilds both Docker images, and verifies the result.
- `docker/Dockerfile.tenant-rebuild` - may need small adjustments so the tenant rebuild path works with the artifact layout produced by `update-opencode.sh`.
- `docker/tests/tg-cli-image.test.sh` - extend image checks to prove the final image reports an OpenCode version.
- `docker/tests/tenant-entrypoint-permissions.test.sh` - preserve this as the permission/ownership regression gate for the update flow; only touch it if the new script requires a minimal hook for version-aware validation.
- `docker/README.md` - document how to run `docker/update-opencode.sh`, what it rebuilds, and what success means.
- `docker/README-ru.md` - same guidance in Russian.
- `CHANGELOG.md` - record the new automated OpenCode refresh workflow.

---

### Task 1: Add Failing Coverage For The End-To-End Update Flow Contract

**Files:**

- Modify: `docker/tests/tg-cli-image.test.sh`
- Create: `docker/tests/update-opencode-smoke.test.sh`

- [ ] **Step 1: Write the failing image-level version assertion first**

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
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v ssh >/dev/null && command -v scp >/dev/null && command -v sftp >/dev/null && command -v ssh-keygen >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'ssh -V >/dev/null 2>&1'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode >/dev/null && opencode --version >/tmp/opencode-version.txt && test -s /tmp/opencode-version.txt'
"${DOCKER_CMD}" run --rm \
  --entrypoint sh \
  -e TG_API_ID=123 \
  -e TG_API_HASH=abc \
  "${IMAGE}" \
  -lc 'command -v opencode-tg-cli >/dev/null && opencode-tg-cli --help >/dev/null'
"${DOCKER_CMD}" run --rm --entrypoint sh "${IMAGE}" -lc 'command -v opencode-gemini-media >/dev/null && test -f /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs && test -f /usr/local/bin/docker-entrypoint.sh'

printf 'ok: tg-cli, ssh tools, and opencode version are present in the image\n'
```

- [ ] **Step 2: Write a failing smoke test for the new orchestration script**

```bash
# Create docker/tests/update-opencode-smoke.test.sh with:
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DOCKER_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

if [[ ! -x "${DOCKER_DIR}/update-opencode.sh" ]]; then
  echo "FAIL: expected executable update script at ${DOCKER_DIR}/update-opencode.sh" >&2
  exit 1
fi

if ! grep -Fq 'https://github.com/anomalyco/opencode' "${DOCKER_DIR}/update-opencode.sh"; then
  echo "FAIL: update-opencode.sh must fetch upstream OpenCode from GitHub" >&2
  exit 1
fi

if ! grep -Fq 'docker/tests/tg-cli-image.test.sh' "${DOCKER_DIR}/update-opencode.sh"; then
  echo "FAIL: update-opencode.sh must run the image verification test" >&2
  exit 1
fi

if ! grep -Fq 'docker/tests/tenant-entrypoint-permissions.test.sh' "${DOCKER_DIR}/update-opencode.sh"; then
  echo "FAIL: update-opencode.sh must run the tenant permission regression test" >&2
  exit 1
fi

printf 'ok: update-opencode.sh wiring is present\n'
```

- [ ] **Step 3: Run the new smoke test to verify it fails before the script exists**

Run: `bash docker/tests/update-opencode-smoke.test.sh`
Expected: FAIL with `expected executable update script` because `docker/update-opencode.sh` does not exist yet.

- [ ] **Step 4: Run the image test to verify the new version assertion is red before the test output string is updated**

Run: `bash docker/tests/tg-cli-image.test.sh`
Expected: PASS on the commands but fail the expected human output check in later plan steps until the final image flow is wired and re-verified. The important part is that the new `opencode --version` assertion is now part of the contract.

- [ ] **Step 5: Commit the failing test contract**

```bash
git add docker/tests/tg-cli-image.test.sh docker/tests/update-opencode-smoke.test.sh
git commit -m "test: define docker opencode update contract"
```

---

### Task 2: Implement `docker/update-opencode.sh` And Tenant Rebuild Flow

**Files:**

- Create: `docker/update-opencode.sh`
- Modify: `docker/Dockerfile.tenant-rebuild`

- [ ] **Step 1: Write the minimal orchestration script to satisfy the smoke test**

```bash
# Create docker/update-opencode.sh with:
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source "${SCRIPT_DIR}/bin/docker-env.sh"
opencode_init_docker_env

UPSTREAM_REPO_URL="${OPENCODE_UPSTREAM_REPO:-https://github.com/anomalyco/opencode}"
UPSTREAM_REF="${OPENCODE_UPSTREAM_REF:-}"
WORK_DIR="${OPENCODE_UPDATE_WORK_DIR:-${SCRIPT_DIR}/.cache/opencode-upstream}"
SOURCE_DIR="${WORK_DIR}/repo"
LOCAL_BUILD_DIR="${SCRIPT_DIR}/local-build"
TENANT_IMAGE="${OPENCODE_TENANT_IMAGE:-opencode-tenant:local}"
FINAL_IMAGE="${OPENCODE_DOCKER_IMAGE:-opencode-tg:local}"

mkdir -p "${WORK_DIR}" "${LOCAL_BUILD_DIR}"

if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  git clone "${UPSTREAM_REPO_URL}" "${SOURCE_DIR}"
fi

git -C "${SOURCE_DIR}" fetch --tags --force origin

if [[ -n "${UPSTREAM_REF}" ]]; then
  git -C "${SOURCE_DIR}" checkout --force "${UPSTREAM_REF}"
else
  DEFAULT_BRANCH="$(git -C "${SOURCE_DIR}" remote show origin | sed -n '/HEAD branch/s/.*: //p')"
  git -C "${SOURCE_DIR}" checkout --force "${DEFAULT_BRANCH}"
  git -C "${SOURCE_DIR}" pull --ff-only origin "${DEFAULT_BRANCH}"
fi

RESOLVED_REF="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
echo "Using upstream OpenCode ref: ${RESOLVED_REF}"

rm -rf "${LOCAL_BUILD_DIR}/opencode-linux-x64"

cd "${SOURCE_DIR}"
bun install --frozen-lockfile
bun run build
mkdir -p "${LOCAL_BUILD_DIR}/opencode-linux-x64/bin"
cp "${SOURCE_DIR}/packages/opencode/dist/opencode-linux-x64/bin/opencode" "${LOCAL_BUILD_DIR}/opencode-linux-x64/bin/opencode"
chmod +x "${LOCAL_BUILD_DIR}/opencode-linux-x64/bin/opencode"

docker build \
  -f "${SCRIPT_DIR}/Dockerfile.tenant-rebuild" \
  -t "${TENANT_IMAGE}" \
  "${SCRIPT_DIR}"

TG_CLI_SOURCE_DIR="${SCRIPT_DIR}/tg-cli" OPENCODE_TENANT_IMAGE="${TENANT_IMAGE}" OPENCODE_DOCKER_IMAGE="${FINAL_IMAGE}" "${SCRIPT_DIR}/build-opencode-tg-image.sh"

echo "Tenant image version:"
docker run --rm --entrypoint sh "${TENANT_IMAGE}" -lc 'opencode --version'
echo "Final image version:"
docker run --rm --entrypoint sh "${FINAL_IMAGE}" -lc 'opencode --version'

bash "${SCRIPT_DIR}/tests/tg-cli-image.test.sh"
bash "${SCRIPT_DIR}/tests/tenant-entrypoint-permissions.test.sh"
```

- [ ] **Step 2: Make the update script executable**

Run: `chmod +x docker/update-opencode.sh`
Expected: PASS with no output.

- [ ] **Step 3: Adjust the tenant rebuild Dockerfile only if the local artifact path or base image tag needs normalization**

```Dockerfile
# If needed, update docker/Dockerfile.tenant-rebuild to:
FROM opencode-tenant:latest

USER root

COPY local-build/opencode-linux-x64/bin/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode && opencode --version

COPY local-build/kabi_tg_cli-*.whl /tmp/
RUN python3 -m pip install --break-system-packages --force-reinstall /tmp/kabi_tg_cli-*.whl \
  && rm -f /tmp/kabi_tg_cli-*.whl
```

If no path or tag changes are required after verifying the script, leave this file unchanged.

- [ ] **Step 4: Run the smoke test to verify the new script wiring now passes**

Run: `bash docker/tests/update-opencode-smoke.test.sh`
Expected: PASS with `ok: update-opencode.sh wiring is present`.

- [ ] **Step 5: Run the new update script end-to-end**

Run: `bash docker/update-opencode.sh`
Expected: PASS with the script printing the upstream ref, rebuilding `opencode-tenant:local`, rebuilding `opencode-tg:local`, printing `opencode --version` for both images, and finishing with both Docker tests green.

- [ ] **Step 6: Commit the automated update flow**

```bash
git add docker/update-opencode.sh docker/Dockerfile.tenant-rebuild
git commit -m "feat: automate docker opencode refresh"
```

---

### Task 3: Document The Update Workflow And Record The Change

**Files:**

- Modify: `docker/README.md`
- Modify: `docker/README-ru.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the English Docker update workflow section**

````markdown
# In docker/README.md, add `update-opencode.sh` to the Files list:

- `update-opencode.sh` - fetches upstream OpenCode, rebuilds `opencode-tenant:local`, rebuilds `opencode-tg:local`, and runs Docker verification

# Add a new section after "Build the Docker image from local artifacts":

## Refresh OpenCode from upstream

To refresh the Docker runtime to the latest upstream OpenCode build and keep the current tenant permission model, run:

```bash
/home/me/MyProjects/opencode-tg/docker/update-opencode.sh
```
````

What it does:

- fetches or refreshes the upstream OpenCode repository from `https://github.com/anomalyco/opencode`
- builds the Linux x64 OpenCode distribution used by the tenant rebuild layer
- rebuilds `opencode-tenant:local`
- rebuilds `opencode-tg:local`
- prints `opencode --version` from both images
- runs `docker/tests/tg-cli-image.test.sh`
- runs `docker/tests/tenant-entrypoint-permissions.test.sh`

Optional override for a specific upstream ref:

```bash
OPENCODE_UPSTREAM_REF='v1.14.28' /home/me/MyProjects/opencode-tg/docker/update-opencode.sh
```

After a successful run, the next tenant start that uses the default `opencode-tg:local` image tag will launch the updated OpenCode version.

````

- [ ] **Step 2: Add the Russian Docker update workflow section**

```markdown
# In docker/README-ru.md, add `update-opencode.sh` to the Files list:
- `update-opencode.sh` — забирает upstream OpenCode, пересобирает `opencode-tenant:local`, пересобирает `opencode-tg:local` и запускает Docker-проверки

# Add a new section after "Сборка Docker image из локальных артефактов":
## Обновление OpenCode из upstream

Чтобы обновить Docker runtime до свежей upstream-сборки OpenCode и сохранить текущую tenant permission model, выполните:

```bash
/home/me/MyProjects/opencode-tg/docker/update-opencode.sh
````

Что делает скрипт:

- скачивает или обновляет upstream OpenCode repository из `https://github.com/anomalyco/opencode`
- собирает Linux x64 OpenCode distribution для tenant rebuild layer
- пересобирает `opencode-tenant:local`
- пересобирает `opencode-tg:local`
- выводит `opencode --version` из обоих image
- запускает `docker/tests/tg-cli-image.test.sh`
- запускает `docker/tests/tenant-entrypoint-permissions.test.sh`

Необязательное переопределение для конкретного upstream ref:

```bash
OPENCODE_UPSTREAM_REF='v1.14.28' /home/me/MyProjects/opencode-tg/docker/update-opencode.sh
```

После успешного выполнения следующий tenant start, использующий тег `opencode-tg:local` по умолчанию, запустит уже обновленную версию OpenCode.

````

- [ ] **Step 3: Record the new update automation in the changelog**

```markdown
# In CHANGELOG.md under ## [Unreleased] -> ### Added, insert:
- Added `docker/update-opencode.sh` to fetch upstream OpenCode from GitHub, rebuild `opencode-tenant:local`, rebuild `opencode-tg:local`, and re-run Docker version and permission verification before the refreshed image is used for tenant containers.
  - Why: operators need a repeatable one-command refresh path for OpenCode inside the Docker tenant runtime without changing the current workspace/state permission model.
  - Affects: `docker/update-opencode.sh`, `docker/Dockerfile.tenant-rebuild`, `docker/tests/tg-cli-image.test.sh`, `docker/tests/update-opencode-smoke.test.sh`, `docker/README.md`, `docker/README-ru.md`
````

- [ ] **Step 4: Commit the docs and changelog updates**

```bash
git add docker/README.md docker/README-ru.md CHANGELOG.md
git commit -m "docs: describe docker opencode update flow"
```

---

### Task 4: Run Final Verification For The Automated Update Path

**Files:**

- Modify: none
- Test: `docker/tests/update-opencode-smoke.test.sh`
- Test: `docker/tests/tg-cli-image.test.sh`
- Test: `docker/tests/tenant-entrypoint-permissions.test.sh`

- [ ] **Step 1: Run the new smoke test on the completed tree**

Run: `bash docker/tests/update-opencode-smoke.test.sh`
Expected: PASS with `ok: update-opencode.sh wiring is present`.

- [ ] **Step 2: Run the full automated update script again as the final Docker refresh verification**

Run: `bash docker/update-opencode.sh`
Expected: PASS with a refreshed upstream checkout, rebuilt tenant/final images, printed OpenCode versions, and both Docker tests green.

- [ ] **Step 3: Run the repository build check required by project workflow**

Run: `npm run build`
Expected: PASS with the TypeScript project building successfully.

- [ ] **Step 4: Run the repository lint check required by project workflow**

Run: `npm run lint`
Expected: PASS, or if unrelated pre-existing warnings remain, capture the exact evidence and do not claim a clean lint result.

- [ ] **Step 5: Run the repository test suite required by project workflow**

Run: `npm test`
Expected: PASS with the existing automated test suite green.

---

## Self-Review

- Spec coverage: Task 1 defines the update-script contract and image version checks, Task 2 implements the end-to-end refresh script and tenant rebuild path, Task 3 documents the operator workflow, and Task 4 re-runs the automated update plus required repo verification.
- Placeholder scan: each task contains exact file paths, concrete shell snippets, exact commands, and expected outputs; no `TODO` or "implement later" text remains.
- Type and path consistency: the plan consistently uses `docker/update-opencode.sh`, `opencode-tenant:local`, `opencode-tg:local`, `local-build/opencode-linux-x64/bin/opencode`, and the two Docker verification tests across all tasks.
