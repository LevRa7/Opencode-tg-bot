#!/usr/bin/env bash

opencode_docker_env_is_ready() {
  docker version >/dev/null 2>&1
}

opencode_init_docker_env() {
  local helper_dir docker_root_dir docker_config_dir user_socket original_docker_host=""

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker CLI not found in PATH" >&2
    return 1
  fi

  helper_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  docker_root_dir="$(CDPATH= cd -- "${helper_dir}/.." && pwd)"
  docker_config_dir="${DOCKER_CONFIG:-${docker_root_dir}/.docker-config}"
  user_socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock"

  mkdir -p "$docker_config_dir"
  export DOCKER_CONFIG="$docker_config_dir"

  if [[ -n "${DOCKER_HOST:-}" ]]; then
    original_docker_host="$DOCKER_HOST"

    if opencode_docker_env_is_ready; then
      return 0
    fi

    if [[ -S "$user_socket" && "$original_docker_host" != "unix://${user_socket}" ]]; then
      export DOCKER_HOST="unix://${user_socket}"
      if opencode_docker_env_is_ready; then
        return 0
      fi
    fi

    unset DOCKER_HOST
    if opencode_docker_env_is_ready; then
      return 0
    fi

    export DOCKER_HOST="$original_docker_host"
    echo "Docker daemon is not accessible via DOCKER_HOST=${original_docker_host}. Start a user Docker daemon or grant this user Docker access without sudo." >&2
    return 1
  fi

  if [[ -S "$user_socket" ]]; then
    export DOCKER_HOST="unix://${user_socket}"
    if opencode_docker_env_is_ready; then
      return 0
    fi
    unset DOCKER_HOST
  fi

  if opencode_docker_env_is_ready; then
    return 0
  fi

  echo "Docker daemon is not accessible for user $(id -un). Start a user Docker daemon or grant this user Docker access without sudo." >&2
  return 1
}
