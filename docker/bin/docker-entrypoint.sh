#!/bin/sh
set -eu

PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export PATH

read_env_value() {
  env_file="$1"
  wanted_key="$2"

  if [ ! -f "$env_file" ]; then
    return 1
  fi

  node -e 'const fs = require("node:fs"); const [file, wantedKey] = process.argv.slice(1); const content = fs.readFileSync(file, "utf8"); for (const rawLine of content.split(/\r?\n/)) { const line = rawLine.trim(); if (!line || line.startsWith("#")) continue; const idx = line.indexOf("="); if (idx === -1) continue; const key = line.slice(0, idx).trim(); let value = line.slice(idx + 1).trim(); if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); if (key === wantedKey) { process.stdout.write(value); process.exit(0); } } process.exit(1);' "$env_file" "$wanted_key"
}

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

merge-agents

# Install skills from the baked-in package at /usr/local/lib/opencode-skills-pkg
# into /state/skills (mounted from host). Existing skills are preserved.
if command -v install-opencode-skills >/dev/null 2>&1; then
  install-opencode-skills --source /usr/local/lib/opencode-skills-pkg --target /state/skills
fi

. /usr/local/bin/ensure-tenant-python-env.sh
ensure_tenant_python_env

mkdir -p /run/opencode-gemini-media
mkdir -p /run/opencode-gpt-image
mkdir -p /run/opencode-secrets

# Fix permissions for cliproxyapi.key if it exists
if [ -f /workspace/.config/opencode/cliproxyapi.key ]; then
  echo "Found cliproxyapi.key, fixing permissions..."
  chmod 600 /workspace/.config/opencode/cliproxyapi.key
  ls -l /workspace/.config/opencode/cliproxyapi.key
else
  echo "WARNING: cliproxyapi.key not found at /workspace/.config/opencode/cliproxyapi.key"
fi

GEMINI_MEDIA_SECRET_FILE="/run/opencode-secrets/gemini-media.env"
GEMINI_MEDIA_UPSTREAM_BASE_URL="$(read_env_value "$GEMINI_MEDIA_SECRET_FILE" GEMINI_MEDIA_BASE_URL || true)"
GEMINI_MEDIA_UPSTREAM_API_KEY="$(read_env_value "$GEMINI_MEDIA_SECRET_FILE" GEMINI_MEDIA_API_KEY || true)"

if [ -n "${GEMINI_MEDIA_UPSTREAM_BASE_URL:-}" ] && [ -n "${GEMINI_MEDIA_UPSTREAM_API_KEY:-}" ]; then
  umask 077
  node -e 'const fs = require("node:fs"); const [baseUrl, apiKey, model] = process.argv.slice(1); fs.writeFileSync("/run/opencode-gemini-media/config.json", JSON.stringify({ baseUrl, apiKey, model: model || "gemini-3.1-flash-lite-preview" }) + "\n", { mode: 0o600 });' "$GEMINI_MEDIA_UPSTREAM_BASE_URL" "$GEMINI_MEDIA_UPSTREAM_API_KEY" "${GEMINI_MEDIA_MODEL:-gemini-3.1-flash-lite-preview}"
  chown 2000:2000 /run/opencode-gemini-media/config.json
  setpriv --reuid=2000 --regid=2000 --clear-groups --bounding-set=-all --nnp \
    node /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs &
fi

GPT_IMAGE_SECRET_FILE="/run/opencode-secrets/gpt-image.env"
GPT_IMAGE_UPSTREAM_BASE_URL="$(read_env_value "$GPT_IMAGE_SECRET_FILE" OPENAI_BASE_URL || true)"
GPT_IMAGE_UPSTREAM_API_KEY="$(read_env_value "$GPT_IMAGE_SECRET_FILE" OPENAI_API_KEY || true)"

if [ -n "${GPT_IMAGE_UPSTREAM_BASE_URL:-}" ] && [ -n "${GPT_IMAGE_UPSTREAM_API_KEY:-}" ]; then
  umask 077
  node -e 'const fs = require("node:fs"); const [baseUrl, apiKey, model] = process.argv.slice(1); fs.writeFileSync("/run/opencode-gpt-image/config.json", JSON.stringify({ baseUrl, apiKey, model: model || "gpt-image-2" }) + "\n", { mode: 0o600 });' "$GPT_IMAGE_UPSTREAM_BASE_URL" "$GPT_IMAGE_UPSTREAM_API_KEY" "${GPT_IMAGE_MODEL:-gpt-image-2}"
  chown 2000:2000 /run/opencode-gpt-image/config.json
  setpriv --reuid=2000 --regid=2000 --clear-groups --bounding-set=-all --nnp \
    node /usr/local/lib/opencode-gpt-image/gpt-image-proxy.mjs &
fi

unset GEMINI_MEDIA_UPSTREAM_BASE_URL
unset GEMINI_MEDIA_UPSTREAM_API_KEY
unset GEMINI_MEDIA_MODEL
unset GPT_IMAGE_UPSTREAM_BASE_URL
unset GPT_IMAGE_UPSTREAM_API_KEY
unset GPT_IMAGE_MODEL

# ── Start file-server for agent file delivery ──
if command -v file-server.py >/dev/null 2>&1; then
  nohup python3 /usr/local/bin/file-server.py start > /dev/null 2>&1 &
  echo "file-server started"
fi

# Rootless Docker bind mounts expose the host user as container root, not uid 1000.
# Keep uid/gid 0 for writable /workspace and /state, but drop all capabilities and
# move the proxy config to a different owner so the tenant runtime still cannot read it.
exec /usr/bin/env \
  PATH="${TENANT_RUNTIME_PATH:-${PATH}}" \
  /usr/bin/setpriv --reuid=0 --regid=0 --clear-groups --bounding-set=-all --nnp \
  /usr/local/bin/opencode "$@"
