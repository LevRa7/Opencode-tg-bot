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

  assert_log_contains "${calls_log}" "git clone" "expected script to run git clone"
  assert_log_contains "${calls_log}" "git ls-remote --symref https://github.com/anomalyco/opencode HEAD" "expected script to resolve upstream HEAD before cloning"
  assert_log_contains "${calls_log}" "https://github.com/anomalyco/opencode" "expected git clone to target https://github.com/anomalyco/opencode"
  assert_log_contains "${calls_log}" "ran tg-cli-image.test.sh" "expected docker/tests/tg-cli-image.test.sh to run"
  assert_log_contains "${calls_log}" "ran tenant-entrypoint-permissions.test.sh" "expected docker/tests/tenant-entrypoint-permissions.test.sh to run"
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

  assert_log_contains "${calls_log}" "git ls-remote --symref https://github.com/anomalyco/opencode HEAD" "expected script to attempt remote HEAD resolution"
  assert_log_contains "${output_log}" "ERROR: unable to resolve upstream default branch from https://github.com/anomalyco/opencode" "expected script to fail when remote HEAD is unavailable"
}

run_update_script_smoke "${REAL_TARGET_SCRIPT}"
run_update_script_requires_remote_head "${REAL_TARGET_SCRIPT}"

printf 'ok: update-opencode script contract is present\n'
