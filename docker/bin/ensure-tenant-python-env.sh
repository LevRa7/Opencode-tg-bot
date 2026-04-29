#!/bin/sh
set -eu

TRUSTED_SYSTEM_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

require_safe_tenant_root() {
  tenant_path="$1"
  tenant_label="$2"

  if [ -L "${tenant_path}" ] || { [ -e "${tenant_path}" ] && [ ! -d "${tenant_path}" ]; }; then
    echo "refusing to use non-directory ${tenant_label}: ${tenant_path}" >&2
    exit 1
  fi
}

tenant_python_env_has_expected_layout() {
  tenant_default_venv="$1"
  tenant_bin_dir="${tenant_default_venv}/bin"
  pip_shebang="$(sed -n '1p' "${tenant_bin_dir}/pip" 2>/dev/null)"

  [ -d "${tenant_default_venv}" ] \
    && [ ! -L "${tenant_default_venv}" ] \
    && [ -f "${tenant_default_venv}/pyvenv.cfg" ] \
    && [ -d "${tenant_bin_dir}" ] \
    && [ ! -L "${tenant_bin_dir}" ] \
    && [ -x "${tenant_bin_dir}/python" ] \
    && [ -x "${tenant_bin_dir}/python3" ] \
    && [ -f "${tenant_bin_dir}/pip" ] \
    && [ ! -L "${tenant_bin_dir}/pip" ] \
    && [ -x "${tenant_bin_dir}/pip" ] \
    && case "${pip_shebang}" in
      "#!${tenant_bin_dir}/"*)
        return 0
        ;;
      *)
        return 1
        ;;
    esac
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

  # 2026-04: Root used to execute ${HOME}/.venvs/default/bin/* while validating the
  # tenant venv. Only trust filesystem shape during preflight and rebuild anything
  # suspicious with the system interpreter before the tenant runtime can use it.
  require_safe_tenant_root "${tenant_venv_root}" "tenant venv root"
  require_safe_tenant_root "${tenant_cache_root}" "tenant cache root"
  require_safe_tenant_root "${tenant_home}/.local" "tenant local root"

  mkdir -p "${tenant_venv_root}" "${tenant_local_bin}" "${tenant_pip_cache}"

  if [ -e "${tenant_default_venv}" ] && ! tenant_python_env_has_expected_layout "${tenant_default_venv}"; then
    rm -rf "${tenant_default_venv}"
    needs_bootstrap="1"
  fi

  if [ ! -d "${tenant_default_venv}" ]; then
    /usr/bin/python3 -m venv "${tenant_default_venv}"
    needs_bootstrap="1"
  fi

  if [ "${needs_bootstrap}" = "1" ] && [ -d "${wheels_dir}" ]; then
    /usr/bin/python3 -m pip --python "${tenant_default_venv}/bin/python" install \
      --no-index \
      --find-links "${wheels_dir}" \
      --upgrade pip setuptools wheel >/dev/null
  fi

  VIRTUAL_ENV="${tenant_default_venv}"
  PIP_CACHE_DIR="${tenant_pip_cache}"
  TENANT_RUNTIME_PATH="${tenant_default_venv}/bin:${tenant_local_bin}:${TRUSTED_SYSTEM_PATH}"
  export VIRTUAL_ENV PIP_CACHE_DIR TENANT_RUNTIME_PATH
}
