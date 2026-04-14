#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source "${SCRIPT_DIR}/bin/docker-env.sh"
opencode_init_docker_env

container_ids="$(docker ps -aq --filter 'name=^/opencode-serve-')"
if [[ -z "$container_ids" ]]; then
  exit 0
fi

while IFS= read -r container_id; do
  [[ -z "$container_id" ]] && continue
  docker rm -f "$container_id" >/dev/null
  printf 'Stopped Docker container: %s\n' "$container_id"
done <<< "$container_ids"
