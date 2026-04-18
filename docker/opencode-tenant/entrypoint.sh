#!/bin/sh
set -eu

: "${OPENCODE_WORKSPACE:=/workspace}"
: "${HOME:=/home/tenant}"
: "${XDG_CONFIG_HOME:=/var/lib/tg-cli/.config}"
: "${XDG_CACHE_HOME:=/var/lib/tg-cli/.cache}"
: "${XDG_STATE_HOME:=/var/lib/tg-cli/.local/state}"
: "${TG_CLI_HOME:=/var/lib/tg-cli}"
: "${TG_SESSIONS_ROOT:=/var/lib/tg-cli/sessions}"
: "${SUPERVISORD_RUNTIME_DIR:=/var/lib/tg-cli/.supervisor}"
: "${OPENCODE_SERVER_COMMAND:=opencode serve --hostname 0.0.0.0 --port 4096}"
: "${TG_CLI_DAEMON_COMMAND:=tg daemon --host 0.0.0.0 --port 8081}"

mkdir -p \
  "${OPENCODE_WORKSPACE}" \
  "${HOME}" \
  "${XDG_CONFIG_HOME}" \
  "${XDG_CACHE_HOME}" \
  "${XDG_STATE_HOME}" \
  "${TG_CLI_HOME}" \
  "${TG_SESSIONS_ROOT}" \
  "${TG_SESSIONS_ROOT}/_daemon" \
  "${SUPERVISORD_RUNTIME_DIR}"

export OPENCODE_WORKSPACE
export HOME
export XDG_CONFIG_HOME
export XDG_CACHE_HOME
export XDG_STATE_HOME
export TG_CLI_HOME
export TG_SESSIONS_ROOT
export SUPERVISORD_RUNTIME_DIR
export OPENCODE_SERVER_COMMAND
export TG_CLI_DAEMON_COMMAND

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/opencode-tenant.conf
