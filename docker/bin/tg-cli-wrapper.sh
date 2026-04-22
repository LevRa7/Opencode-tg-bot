#!/usr/bin/env sh
set -eu

TG_STATE_DIR="${TG_STATE_DIR:-${TG_CONFIG_DIR:-/state/tg-cli}}"
TG_WORKSPACE_ROOT="${TG_WORKSPACE_ROOT:-${TG_STATE_DIR}/workspaces}"
DATA_DIR="${DATA_DIR:-${TG_STATE_DIR}/data}"
DB_PATH="${DB_PATH:-${DATA_DIR}/messages.db}"

if [ -z "${TG_API_ID:-}" ] || [ -z "${TG_API_HASH:-}" ]; then
  echo "TG_API_ID and TG_API_HASH must be set" >&2
  exit 1
fi

mkdir -p "${TG_STATE_DIR}" "${TG_WORKSPACE_ROOT}" "${DATA_DIR}"

if [ -n "${TG_ID:-}" ]; then
  export TG_ID
elif [ -n "${TG_USER_ID:-}" ]; then
  TG_ID="${TG_USER_ID}"
  export TG_ID
fi

export TG_WORKSPACE_ROOT DATA_DIR DB_PATH

if command -v tg >/dev/null 2>&1; then
  exec tg "$@"
fi

exec telegram-cli "$@"
