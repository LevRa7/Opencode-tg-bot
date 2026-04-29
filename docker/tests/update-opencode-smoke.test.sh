#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REAL_TARGET_SCRIPT="${REPO_ROOT}/docker/update-opencode.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
  echo "FAIL: $1" >&2
  return 1
}

write_git_stub() {
  local stub_path="$1"
  local emit_head_ref="${2:-yes}"

  cat >"${stub_path}" <<EOF
#!/bin/bash
set -euo pipefail
emit_head_ref='${emit_head_ref}'
printf 'git %s\n' "\$*" >>"\${CALLS_LOG}"

if [ "\${1:-}" = "clone" ]; then
  shift
  args=("\$@")
  arg_count="\${#args[@]}"

  if [ "\${arg_count}" -gt 0 ]; then
    last_index=\$((arg_count - 1))
    repo_arg="\${args[\${last_index}]}"
    dest_arg=""

    if [ "\${arg_count}" -ge 2 ]; then
      previous_arg="\${args[\$((last_index - 1))]}"

      case "\${previous_arg}" in
        http://*|https://*|ssh://*|git@*:*|*/*.git|*/*)
          repo_arg="\${previous_arg}"
          dest_arg="\${args[\${last_index}]}"
          ;;
      esac
    fi

    if [ -z "\${dest_arg}" ]; then
      dest_arg="\${repo_arg%/}"
      dest_arg="\${dest_arg##*/}"
      dest_arg="\${dest_arg%.git}"
    fi

    mkdir -p "\${dest_arg}"
  fi
fi

if [ "\${1:-}" = "ls-remote" ] && [ "\${emit_head_ref}" = "yes" ]; then
  printf 'ref: refs/heads/main\tHEAD\n'
fi

exit 0
EOF
  chmod +x "${stub_path}"
}

write_bash_stub() {
  local stub_path="$1"

  cat >"${stub_path}" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'bash %s\n' "$*" >>"${CALLS_LOG}"
exec /bin/bash "$@"
EOF
  chmod +x "${stub_path}"
}

write_stub_test_script() {
  local script_path="$1"
  local marker="$2"

  cat >"${script_path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '${marker}' >>"\${CALLS_LOG}"
EOF
  chmod +x "${script_path}"
}

assert_log_contains() {
  local log_path="$1"
  local needle="$2"
  local message="$3"

  if ! grep -Fq "${needle}" "${log_path}"; then
    fail "${message}"
  fi
}

assert_log_matches() {
  local log_path="$1"
  local pattern="$2"
  local message="$3"

  if ! grep -Eq "${pattern}" "${log_path}"; then
    fail "${message}"
  fi
}

run_update_script_smoke() {
  local source_script="$1"

  if [ ! -x "${source_script}" ]; then
    fail "expected executable script at ${source_script}"
    return 1
  fi

  local fake_repo_root="${TMP_DIR}/repo"
  local fake_bin="${TMP_DIR}/bin"
  local calls_log="${TMP_DIR}/calls.log"
  local output_log="${TMP_DIR}/output.log"

  rm -rf "${fake_repo_root}" "${fake_bin}"
  mkdir -p "${fake_repo_root}/docker/tests" "${fake_bin}"
  : >"${calls_log}"
  : >"${output_log}"

  cp "${source_script}" "${fake_repo_root}/docker/update-opencode.sh"
  chmod +x "${fake_repo_root}/docker/update-opencode.sh"

  write_stub_test_script "${fake_repo_root}/docker/tests/tg-cli-image.test.sh" "ran tg-cli-image.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-python-env.test.sh" "ran tenant-python-env.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-entrypoint-permissions.test.sh" "ran tenant-entrypoint-permissions.test.sh"
  write_git_stub "${fake_bin}/git"
  write_bash_stub "${fake_bin}/bash"

  if ! (
    cd "${fake_repo_root}" &&
      PATH="${fake_bin}:${PATH}" CALLS_LOG="${calls_log}" /bin/bash "${fake_repo_root}/docker/update-opencode.sh"
  ) >"${output_log}" 2>&1; then
    local output
    output="$(<"${output_log}")"
    if [ -n "${output}" ]; then
      fail "script execution failed for ${source_script}: ${output}"
    fi

    fail "script execution failed for ${source_script}"
    return 1
  fi

  assert_log_contains "${calls_log}" "git clone" "expected script to run git clone" || return 1
  assert_log_contains "${calls_log}" "git ls-remote --symref https://github.com/anomalyco/opencode HEAD" "expected script to resolve upstream HEAD before cloning" || return 1
  assert_log_matches "${calls_log}" '^git clone --depth 1 --branch main https://github\.com/anomalyco/opencode ' "expected git clone to target https://github.com/anomalyco/opencode" || return 1
  assert_log_contains "${calls_log}" "ran tg-cli-image.test.sh" "expected docker/tests/tg-cli-image.test.sh to run" || return 1
  assert_log_contains "${calls_log}" "ran tenant-python-env.test.sh" "expected docker/tests/tenant-python-env.test.sh to run" || return 1
  assert_log_contains "${calls_log}" "ran tenant-entrypoint-permissions.test.sh" "expected docker/tests/tenant-entrypoint-permissions.test.sh to run" || return 1
}

write_docker_stub() {
  local stub_path="$1"

  cat >"${stub_path}" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'docker %s\n' "$*" >>"${CALLS_LOG}"
exit 0
EOF
  chmod +x "${stub_path}"
}

write_bun_stub() {
  local stub_path="$1"

  cat >"${stub_path}" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'bun %s\n' "$*" >>"${CALLS_LOG}"

if [ "${1:-}" = "run" ]; then
  dist_bin="${PWD}/packages/opencode/dist/opencode-linux-x64/bin/opencode"
  mkdir -p "$(dirname "${dist_bin}")"
  cat >"${dist_bin}" <<'INNER'
#!/bin/sh
exit 0
INNER
  chmod +x "${dist_bin}"
fi

exit 0
EOF
  chmod +x "${stub_path}"
}

write_python3_stub() {
  local stub_path="$1"

  cat >"${stub_path}" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'python3 %s\n' "$*" >>"${CALLS_LOG}"

if [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "wheel" ]; then
  wheel_dir=""
  shift 3

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --wheel-dir)
        wheel_dir="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "${wheel_dir}"
  : >"${wheel_dir}/kabi_tg_cli-0.0.0-py3-none-any.whl"
  exit 0
fi

if [ "${1:-}" = "-" ]; then
  cat >/dev/null
  printf '{}\n'
  exit 0
fi

exit 0
EOF
  chmod +x "${stub_path}"
}

write_env_stub() {
  local stub_path="$1"

  cat >"${stub_path}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

opencode_init_docker_env() {
  printf 'opencode_init_docker_env\n' "${CALLS_LOG}" >>"${CALLS_LOG}"
}
EOF
  chmod +x "${stub_path}"
}

write_build_script_stub() {
  local stub_path="$1"

  cat >"${stub_path}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'build-opencode-tg-image.sh\n' >>"${CALLS_LOG}"
EOF
  chmod +x "${stub_path}"
}

run_update_script_full_path() {
  local source_script="$1"

  if [ ! -x "${source_script}" ]; then
    fail "expected executable script at ${source_script}"
    return 1
  fi

  local fake_repo_root="${TMP_DIR}/repo-full"
  local fake_bin="${TMP_DIR}/bin-full"
  local calls_log="${TMP_DIR}/calls-full.log"
  local output_log="${TMP_DIR}/output-full.log"

  rm -rf "${fake_repo_root}" "${fake_bin}"
  mkdir -p \
    "${fake_repo_root}/docker/tests" \
    "${fake_repo_root}/docker/bin" \
    "${fake_repo_root}/docker/vendor/python-tg-cli" \
    "${fake_bin}"
  : >"${calls_log}"
  : >"${output_log}"

  cp "${source_script}" "${fake_repo_root}/docker/update-opencode.sh"
  chmod +x "${fake_repo_root}/docker/update-opencode.sh"
  : >"${fake_repo_root}/docker/Dockerfile"

  write_stub_test_script "${fake_repo_root}/docker/tests/tg-cli-image.test.sh" "ran tg-cli-image.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-python-env.test.sh" "ran tenant-python-env.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-entrypoint-permissions.test.sh" "ran tenant-entrypoint-permissions.test.sh"
  write_env_stub "${fake_repo_root}/docker/bin/docker-env.sh"
  write_build_script_stub "${fake_repo_root}/docker/build-opencode-tg-image.sh"
  write_git_stub "${fake_bin}/git"
  write_bash_stub "${fake_bin}/bash"
  write_bun_stub "${fake_bin}/bun"
  write_python3_stub "${fake_bin}/python3"
  write_docker_stub "${fake_bin}/docker"

  if ! (
    cd "${fake_repo_root}" &&
      PATH="${fake_bin}:${PATH}" CALLS_LOG="${calls_log}" /bin/bash "${fake_repo_root}/docker/update-opencode.sh"
  ) >"${output_log}" 2>&1; then
    local output
    output="$(<"${output_log}")"
    if [ -n "${output}" ]; then
      fail "full-path script execution failed for ${source_script}: ${output}"
    fi

    fail "full-path script execution failed for ${source_script}"
    return 1
  fi

  assert_log_contains "${calls_log}" "opencode_init_docker_env" "expected non-smoke path to source docker env helper" || return 1
  assert_log_contains "${calls_log}" "docker build --build-arg TENANT_BASE_IMAGE=opencode-tenant:latest -f" "expected non-smoke path to rebuild the tenant image" || return 1
  assert_log_contains "${calls_log}" "build-opencode-tg-image.sh" "expected non-smoke path to rebuild the Telegram image" || return 1
  assert_log_contains "${calls_log}" "ran tg-cli-image.test.sh" "expected non-smoke path to run docker/tests/tg-cli-image.test.sh" || return 1
  assert_log_contains "${calls_log}" "ran tenant-python-env.test.sh" "expected non-smoke path to run docker/tests/tenant-python-env.test.sh" || return 1
  assert_log_contains "${calls_log}" "ran tenant-entrypoint-permissions.test.sh" "expected non-smoke path to run docker/tests/tenant-entrypoint-permissions.test.sh" || return 1
}

run_update_script_requires_remote_head() {
  local source_script="$1"

  if [ ! -x "${source_script}" ]; then
    fail "expected executable script at ${source_script}"
    return 1
  fi

  local fake_repo_root="${TMP_DIR}/repo-missing-head"
  local fake_bin="${TMP_DIR}/bin-missing-head"
  local calls_log="${TMP_DIR}/calls-missing-head.log"
  local output_log="${TMP_DIR}/output-missing-head.log"

  rm -rf "${fake_repo_root}" "${fake_bin}"
  mkdir -p "${fake_repo_root}/docker/tests" "${fake_bin}"
  : >"${calls_log}"
  : >"${output_log}"

  cp "${source_script}" "${fake_repo_root}/docker/update-opencode.sh"
  chmod +x "${fake_repo_root}/docker/update-opencode.sh"

  write_stub_test_script "${fake_repo_root}/docker/tests/tg-cli-image.test.sh" "ran tg-cli-image.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-python-env.test.sh" "ran tenant-python-env.test.sh"
  write_stub_test_script "${fake_repo_root}/docker/tests/tenant-entrypoint-permissions.test.sh" "ran tenant-entrypoint-permissions.test.sh"
  write_git_stub "${fake_bin}/git" "no"
  write_bash_stub "${fake_bin}/bash"

  if (
    cd "${fake_repo_root}" &&
      PATH="${fake_bin}:${PATH}" CALLS_LOG="${calls_log}" /bin/bash "${fake_repo_root}/docker/update-opencode.sh"
  ) >"${output_log}" 2>&1; then
    fail "expected script to fail when upstream HEAD cannot be resolved"
    return 1
  fi

  assert_log_contains "${calls_log}" "git ls-remote --symref https://github.com/anomalyco/opencode HEAD" "expected script to attempt remote HEAD resolution" || return 1
  assert_log_contains "${output_log}" "ERROR: unable to resolve upstream default branch from https://github.com/anomalyco/opencode" "expected script to fail when remote HEAD is unavailable" || return 1
}

status=0

run_update_script_smoke "${REAL_TARGET_SCRIPT}" || status=1
run_update_script_full_path "${REAL_TARGET_SCRIPT}" || status=1
run_update_script_requires_remote_head "${REAL_TARGET_SCRIPT}" || status=1

if [ "${status}" -ne 0 ]; then
  exit "${status}"
fi

printf 'ok: update-opencode script contract is present\n'
