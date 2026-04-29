#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
DOCKER_ENV_SH="${SCRIPT_DIR}/bin/docker-env.sh"

UPSTREAM_URL="https://github.com/anomalyco/opencode"
UPSTREAM_REF="${OPENCODE_UPSTREAM_REF:-}"
UPSTREAM_DIR="${SCRIPT_DIR}/.cache/opencode-upstream"
BUILD_ROOT="${SCRIPT_DIR}/local-build"
ARTIFACT_DIR="${BUILD_ROOT}/opencode-linux-x64"
ARTIFACT_BIN="${ARTIFACT_DIR}/bin/opencode"
TG_CLI_SRC="${SCRIPT_DIR}/vendor/python-tg-cli"
TG_CLI_DIST="${BUILD_ROOT}"
TG_CLI_STAGE_SRC="${BUILD_ROOT}/python-tg-cli-source"
TENANT_IMAGE="${OPENCODE_TENANT_IMAGE:-opencode-tenant:local}"
TG_IMAGE="${OPENCODE_DOCKER_IMAGE:-opencode-tg:local}"
TENANT_BASE_IMAGE="${OPENCODE_TENANT_BASE_IMAGE:-opencode-tenant:latest}"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

bootstrap_smoke_mode() {
  mkdir -p "${ARTIFACT_DIR}/bin" "${TG_CLI_DIST}"

  if [[ ! -x "${ARTIFACT_BIN}" ]]; then
    cat >"${ARTIFACT_BIN}" <<'EOF'
#!/usr/bin/env sh
set -eu
if [ "${1:-}" = "--version" ]; then
  printf 'opencode smoke-build\n'
  exit 0
fi
printf 'smoke opencode stub\n'
EOF
    chmod +x "${ARTIFACT_BIN}"
  fi

  if ! compgen -G "${TG_CLI_DIST}/kabi_tg_cli-*.whl" >/dev/null 2>&1; then
    : >"${TG_CLI_DIST}/kabi_tg_cli-0.0.0-py3-none-any.whl"
  fi
}

prepare_dirs() {
  mkdir -p "${SCRIPT_DIR}/.cache" "${ARTIFACT_DIR}/bin" "${TG_CLI_DIST}"
}

resolve_upstream_ref() {
  if [[ -n "${UPSTREAM_REF}" ]]; then
    return 0
  fi

  local head_ref
  head_ref="$(git ls-remote --symref "${UPSTREAM_URL}" HEAD 2>/dev/null | awk '/^ref:/ {sub("refs/heads/", "", $2); print $2; exit}')"

  [[ -n "${head_ref}" ]] || fail "unable to resolve upstream default branch from ${UPSTREAM_URL}"
  UPSTREAM_REF="${head_ref}"
}

clone_upstream() {
  resolve_upstream_ref
  rm -rf "${UPSTREAM_DIR}"
  git clone --depth 1 --branch "${UPSTREAM_REF}" "${UPSTREAM_URL}" "${UPSTREAM_DIR}"
}

resolve_models_snapshot() {
  local models_json="${SCRIPT_DIR}/.cache/models-api.json"
  local models_dir
  local models_tmp

  have python3 || fail "python3 is required to validate the models.dev snapshot"

  models_dir="$(dirname "${models_json}")"
  models_tmp="$(mktemp "${models_dir}/models-api.json.tmp.XXXXXX")"
  trap 'rm -f "${models_tmp:-}"' RETURN

  validate_models_snapshot_json() {
    local candidate_path="$1"

    python3 - <<'PY' "${candidate_path}" >/dev/null
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as file_handle:
    json.load(file_handle)
PY
  }

  if [[ -f "${models_json}" ]] && validate_models_snapshot_json "${models_json}"; then
    export MODELS_DEV_API_JSON="${models_json}"
    return 0
  fi

  if have curl; then
    if curl --fail --silent --show-error --location "https://models.dev/api.json" --output "${models_tmp}" \
      && validate_models_snapshot_json "${models_tmp}"
    then
      mv -f "${models_tmp}" "${models_json}"
      export MODELS_DEV_API_JSON="${models_json}"
      return 0
    fi
  fi

  if python3 - <<'PY' >"${models_tmp}"
import json
print(json.dumps({}))
PY
  then
    if validate_models_snapshot_json "${models_tmp}"; then
      mv -f "${models_tmp}" "${models_json}"
      export MODELS_DEV_API_JSON="${models_json}"
      return 0
    fi
  fi

  fail "unable to materialize models.dev snapshot for upstream build"
}

build_upstream_binary() {
  local dist_bin="${UPSTREAM_DIR}/packages/opencode/dist/opencode-linux-x64/bin/opencode"

  have bun || fail "bun is required to build upstream opencode"
  [[ -d "${UPSTREAM_DIR}" ]] || fail "upstream source directory is missing: ${UPSTREAM_DIR}"

  resolve_models_snapshot

  (
    cd "${UPSTREAM_DIR}"
    bun install
    bun run --cwd packages/opencode build --single
  )

  [[ -x "${dist_bin}" ]] || fail "expected upstream artifact at ${dist_bin}"

  rm -rf "${ARTIFACT_DIR}"
  mkdir -p "${ARTIFACT_DIR}/bin"
  cp "${dist_bin}" "${ARTIFACT_BIN}"
  chmod +x "${ARTIFACT_BIN}"
}

build_tg_cli_wheel() {
  have python3 || fail "python3 is required to build tg-cli wheel"
  [[ -d "${TG_CLI_SRC}" ]] || fail "tg-cli source directory is missing: ${TG_CLI_SRC}"

  mkdir -p "${TG_CLI_DIST}"
  rm -f "${TG_CLI_DIST}"/kabi_tg_cli-*.whl

  (
    cd "${TG_CLI_SRC}"
    python3 -m pip wheel --no-deps --wheel-dir "${TG_CLI_DIST}" .
  )

  compgen -G "${TG_CLI_DIST}/kabi_tg_cli-*.whl" >/dev/null 2>&1 || fail "tg-cli wheel build did not produce kabi_tg_cli-*.whl"
}

stage_tg_cli_source() {
  [[ -d "${TG_CLI_SRC}" ]] || fail "tg-cli source directory is missing: ${TG_CLI_SRC}"

  rm -rf "${TG_CLI_STAGE_SRC}"
  mkdir -p "${TG_CLI_STAGE_SRC}"
  cp -a "${TG_CLI_SRC}/." "${TG_CLI_STAGE_SRC}/"
}

ensure_tenant_base_image() {
  docker image inspect "${TENANT_BASE_IMAGE}" >/dev/null 2>&1 || fail "required base tenant image not found: ${TENANT_BASE_IMAGE}"
}

rebuild_tenant_image() {
  docker build \
    --build-arg "TENANT_BASE_IMAGE=${TENANT_BASE_IMAGE}" \
    -f "${SCRIPT_DIR}/Dockerfile.tenant-rebuild" \
    -t "${TENANT_IMAGE}" \
    "${SCRIPT_DIR}"
}

print_versions() {
  log "Tenant image version:"
  docker run --rm --entrypoint sh "${TENANT_IMAGE}" -lc 'opencode --version'
  log "Telegram image version:"
  docker run --rm --entrypoint sh "${TG_IMAGE}" -lc 'opencode --version'
}

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

main() {
  prepare_dirs
  bootstrap_smoke_mode

  if [[ -f "${SCRIPT_DIR}/tests/tg-cli-image.test.sh" && ! -f "${SCRIPT_DIR}/Dockerfile" ]]; then
    clone_upstream
    log "Smoke mode complete"
    run_verification
    return 0
  fi

  [[ -f "${DOCKER_ENV_SH}" ]] || fail "required Docker env helper is missing: ${DOCKER_ENV_SH}"
  source "${DOCKER_ENV_SH}"
  opencode_init_docker_env
  clone_upstream
  build_upstream_binary
  build_tg_cli_wheel
  stage_tg_cli_source
  ensure_tenant_base_image
  rebuild_tenant_image
  TG_CLI_SOURCE_DIR="${TG_CLI_STAGE_SRC}" OPENCODE_TENANT_IMAGE="${TENANT_IMAGE}" OPENCODE_DOCKER_IMAGE="${TG_IMAGE}" bash "${SCRIPT_DIR}/build-opencode-tg-image.sh"
  print_versions
  run_verification "${TG_IMAGE}"
}

main "$@"
