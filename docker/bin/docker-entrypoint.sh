#!/bin/sh
set -eu

merge-agents

home_path="${HOME}"

# 2026-04: Resolve HOME through the filesystem before using it so tenant-controlled
# paths like /workspace/home-link/. cannot hide a symlink that would redirect root.
resolved_home="$(CDPATH= cd -- "${home_path}" 2>/dev/null && pwd -P)" || {
  echo "refusing to use inaccessible home directory: ${home_path}" >&2
  exit 1
}
logical_home="$(CDPATH= cd -- "${home_path}" 2>/dev/null && pwd -L)" || {
  echo "refusing to use inaccessible home directory: ${home_path}" >&2
  exit 1
}

if [ -L "${home_path}" ] || [ "${logical_home}" != "${resolved_home}" ]; then
  echo "refusing to use symlinked home directory: ${home_path}" >&2
  exit 1
fi

HOME="${resolved_home}"
export HOME

if [ -L "${HOME}" ]; then
  echo "refusing to use symlinked home directory: ${HOME}" >&2
  exit 1
fi

tenant_ssh_dir="${HOME}/.ssh"

if [ -L "${tenant_ssh_dir}" ] || { [ -e "${tenant_ssh_dir}" ] && [ ! -d "${tenant_ssh_dir}" ]; }; then
  echo "refusing to use non-directory ssh path: ${tenant_ssh_dir}" >&2
  exit 1
fi

if [ ! -d "${tenant_ssh_dir}" ]; then
  mkdir -p "${tenant_ssh_dir}"
  chmod 700 "${tenant_ssh_dir}"
fi

mkdir -p /run/opencode-gemini-media

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
