#!/bin/sh
set -eu

merge-agents

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
