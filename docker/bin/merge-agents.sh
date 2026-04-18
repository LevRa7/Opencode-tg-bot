#!/bin/sh
# merge-agents.sh - Combines global and project-local AGENTS.md into a single
# effective AGENTS.md at the global OpenCode config path so the runtime loads it.
#
# Priority order (later overrides earlier):
#   1. /etc/opencode/AGENTS.md        — user's global instructions (volume-mounted)
#   2. /etc/opencode-global/AGENTS.md — project's global instructions (baked into image)
#
# The merged result is written to ${XDG_CONFIG_HOME:-/root/.config}/opencode/AGENTS.md

set -eu

OUTPUT_DIR="${XDG_CONFIG_HOME:-/root/.config}/opencode"
OUTPUT_FILE="${OUTPUT_DIR}/AGENTS.md"

mkdir -p "$OUTPUT_DIR"

# Start fresh
: > "$OUTPUT_FILE"

# 1. User's global instructions (volume-mounted, highest priority among globals)
if [ -f /etc/opencode/AGENTS.md ]; then
  cat >> "$OUTPUT_FILE" <<'HEADER'
# Global Instructions (user-managed)
HEADER
  cat /etc/opencode/AGENTS.md >> "$OUTPUT_FILE"
  printf '\n\n---\n\n' >> "$OUTPUT_FILE"
fi

# 2. Project's baked-in global instructions
if [ -f /etc/opencode-global/AGENTS.md ]; then
  cat >> "$OUTPUT_FILE" <<'HEADER'
# Global Instructions (project defaults)
HEADER
  cat /etc/opencode-global/AGENTS.md >> "$OUTPUT_FILE"
  printf '\n\n---\n\n' >> "$OUTPUT_FILE"
fi

# If nothing was found, create a minimal placeholder
if [ ! -s "$OUTPUT_FILE" ]; then
  cat > "$OUTPUT_FILE" <<'EOF'
# AGENTS.md

No global or project-specific instructions found.
EOF
fi

echo "[merge-agents] Merged AGENTS.md -> ${OUTPUT_FILE}"
