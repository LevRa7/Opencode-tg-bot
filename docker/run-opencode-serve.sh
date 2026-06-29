#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source "${SCRIPT_DIR}/bin/docker-env.sh"
opencode_init_docker_env

IMAGE="${OPENCODE_DOCKER_IMAGE:-opencode-tg:local}"
HOST_PORT="${HOST_PORT:-49600}"
CONTAINER_PORT="4096"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-/home/me/Workspaces}"
TG_ID="${TG_ID:-}"
TG_CHAT_ID="${TG_CHAT_ID:-$TG_ID}"
TG_TENANT_ID="${TG_TENANT_ID:-}"
CONFIG_DIR="${OPENCODE_TELEGRAM_ADMIN_HOME:-${HOME}/.config/opencode}"
HOST_DATA_DIR="${HOME}/.local/share/opencode"
HOST_AUTH_FILE="${HOST_DATA_DIR}/auth.json"
GLOBAL_AGENTS_FILE="${CONFIG_DIR}/AGENTS.md"
TG_API_ID="${TG_API_ID:-29814416}"
TG_API_HASH="${TG_API_HASH:-58768c18060fee87a1ce635fefd959ab}"
CLIPROXYAPI_BASE_URL="${CLIPROXYAPI_BASE_URL:-http://192.168.2.166:8317/v1}"
TG_EMBEDDING_BASE_URL="${TG_EMBEDDING_BASE_URL:-http://192.168.2.166:8000}"
TG_EMBEDDING_MODEL_ID="${TG_EMBEDDING_MODEL_ID:-google/embeddinggemma-300m}"
TG_EMBEDDING_DIMENSIONS="${TG_EMBEDDING_DIMENSIONS:-768}"
SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:-change-me}"
GEMINI_MEDIA_ENV_FILE="${GEMINI_MEDIA_ENV_FILE:-${CONFIG_DIR}/gemini-media.env}"
GEMINI_MEDIA_MODEL="${GEMINI_MEDIA_MODEL:-gemini-3.1-flash-lite-preview}"
GPT_IMAGE_ENV_FILE="${GPT_IMAGE_ENV_FILE:-${CONFIG_DIR}/gpt-image.env}"
GPT_IMAGE_MODEL="${GPT_IMAGE_MODEL:-gpt-image-2}"

read_env_value() {
  local env_file="$1"
  local wanted_key="$2"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  node -e '
const fs = require("fs");
const [file, wantedKey] = process.argv.slice(1);
const content = fs.readFileSync(file, "utf8");
for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (key === wantedKey) {
    process.stdout.write(value);
    process.exit(0);
  }
}
process.exit(1);
' "$env_file" "$wanted_key"
}

read_gemini_cli_server_token() {
  local env_file="${HOME}/.gemini/.env"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  node -e '
const fs = require("fs");
const file = process.argv[1];
const content = fs.readFileSync(file, "utf8");
for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (key === "GEMINI_CLI_SERVER_TOKEN") {
    process.stdout.write(value);
    process.exit(0);
  }
}
process.exit(1);
' "$env_file"
}

if [[ ! -f "$GEMINI_MEDIA_ENV_FILE" && -f "${HOME}/.gemini/.env" ]]; then
  token_from_gemini="$(read_gemini_cli_server_token || true)"
  if [[ -n "$token_from_gemini" ]]; then
    printf 'GEMINI_MEDIA_BASE_URL=%s\nGEMINI_MEDIA_API_KEY=%s\n' 'http://192.168.2.166:8124/v1' "$token_from_gemini" > "$GEMINI_MEDIA_ENV_FILE"
    chmod 600 "$GEMINI_MEDIA_ENV_FILE"
  fi
fi

# Telegraph config — read from project .env
TELEGRAPH_ENABLED="${TELEGRAPH_ENABLED:-true}"
TELEGRAPH_ACCESS_TOKEN="${TELEGRAPH_ACCESS_TOKEN:-$(read_env_value "${SCRIPT_DIR}/../.env" TELEGRAPH_ACCESS_TOKEN || true)}"
TELEGRAPH_AUTHOR_NAME="${TELEGRAPH_AUTHOR_NAME:-opencode-tg}"

if ! [[ "$HOST_PORT" =~ ^[0-9]+$ ]] || (( HOST_PORT < 49600 || HOST_PORT > 49999 )); then
  echo "HOST_PORT must be in range 49600-49999" >&2
  exit 1
fi

if [[ -z "$TG_ID" ]] || ! [[ "$TG_ID" =~ ^[0-9]+$ ]]; then
  echo "TG_ID must be a positive integer" >&2
  exit 1
fi

if [[ -z "$TG_CHAT_ID" ]] || ! [[ "$TG_CHAT_ID" =~ ^-?[0-9]+$ ]]; then
  echo "TG_CHAT_ID must be an integer" >&2
  exit 1
fi

if [[ -z "$TG_TENANT_ID" ]]; then
  TG_TENANT_ID="tg-${TG_ID}"
fi

SAFE_TENANT_ID="$(printf '%s' "$TG_TENANT_ID" | tr -cs '[:alnum:]._-' '-')"
TENANT_ROOT="${WORKSPACES_ROOT}/${SAFE_TENANT_ID}"
WORKSPACE="${TENANT_ROOT}/workspace"
STATE_DIR="${TENANT_ROOT}/state"
TG_CLI_DIR="${STATE_DIR}/tg-cli"
XDG_CONFIG_DIR="${STATE_DIR}/config"
XDG_CACHE_DIR="${STATE_DIR}/cache"
XDG_STATE_DIR="${STATE_DIR}/xdg-state"
XDG_DATA_DIR="${STATE_DIR}/share"
OPENCODE_DATA_DIR="${XDG_DATA_DIR}/opencode"
STATE_SKILLS_DIR="${STATE_DIR}/skills"
CONTAINER_NAME="opencode-serve-${SAFE_TENANT_ID}"

port_is_occupied_by_opencode_container() {
  local candidate_port="$1"
  local container_name container_ports

  while IFS=$'\t' read -r container_name container_ports; do
    [[ -z "$container_name" ]] && continue
    if [[ "$container_ports" == *":${candidate_port}->4096/tcp"* ]]; then
      return 0
    fi
  done < <(docker ps --format '{{.Names}}\t{{.Ports}}' --filter 'name=^/opencode-serve-')

  return 1
}

select_free_host_port() {
  local candidate_port="$1"

  while (( candidate_port <= 49999 )); do
    if ! port_is_occupied_by_opencode_container "$candidate_port"; then
      printf '%s\n' "$candidate_port"
      return 0
    fi
    ((candidate_port++))
  done

  return 1
}

if [[ ! -d "$WORKSPACES_ROOT" ]]; then
  echo "Workspaces root not found: $WORKSPACES_ROOT" >&2
  exit 1
fi

mkdir -p "$TENANT_ROOT"
mkdir -p "$WORKSPACE"

if [[ ! -d "$HOST_DATA_DIR" ]]; then
  echo "OpenCode data dir not found: $HOST_DATA_DIR" >&2
  exit 1
fi

if [[ ! -f "$HOST_AUTH_FILE" ]]; then
  echo "OpenCode auth file not found: $HOST_AUTH_FILE" >&2
  exit 1
fi

mkdir -p "$TG_CLI_DIR"
mkdir -p "$XDG_CONFIG_DIR"
mkdir -p "$XDG_CACHE_DIR"
mkdir -p "$XDG_STATE_DIR"
mkdir -p "$OPENCODE_DATA_DIR"
mkdir -p "$STATE_SKILLS_DIR/tg-cli"
mkdir -p "$STATE_SKILLS_DIR/embedding-strategies"
mkdir -p "$STATE_SKILLS_DIR/openai-media-transcriber"
mkdir -p "$STATE_SKILLS_DIR/gpt-image-api"

# OpenCode creates this ignore file for OPENCODE_CONFIG_DIR during bootstrap.
# The container mounts this directory read-only, so prepare it on the writable host side.
printf '%s\n' node_modules package.json package-lock.json bun.lock .gitignore > "${XDG_CONFIG_DIR}/.gitignore"

cp "$HOST_AUTH_FILE" "$OPENCODE_DATA_DIR/auth.json"

# Copy OpenCode agent modes (tg-agent.md, etc.) from host to tenant config
HOST_AGENTS_DIR="${CONFIG_DIR}/agents"
TENANT_AGENTS_DIR="${XDG_CONFIG_DIR}/agents"
if [[ -d "$HOST_AGENTS_DIR" ]]; then
  mkdir -p "$TENANT_AGENTS_DIR"
  cp "${HOST_AGENTS_DIR}/"*.md "$TENANT_AGENTS_DIR/" 2>/dev/null || true
  echo "Copied agent modes to tenant config"
fi

# Copy cliproxyapi.key to workspace if it exists
HOST_CLIPROXYAPI_KEY="${CONFIG_DIR}/cliproxyapi.key"
if [[ -f "$HOST_CLIPROXYAPI_KEY" ]]; then
  mkdir -p "$WORKSPACE/.config/opencode"
  # Remove existing file if it belongs to a different user (e.g., from previous container)
  if [[ -f "$WORKSPACE/.config/opencode/cliproxyapi.key" ]] && [[ ! -O "$WORKSPACE/.config/opencode/cliproxyapi.key" ]]; then
    rm -f "$WORKSPACE/.config/opencode/cliproxyapi.key"
  fi
  cp -f "$HOST_CLIPROXYAPI_KEY" "$WORKSPACE/.config/opencode/cliproxyapi.key"
  chown 1000:1000 "$WORKSPACE/.config/opencode/cliproxyapi.key"
  chmod 644 "$WORKSPACE/.config/opencode/cliproxyapi.key"
  echo "Copied cliproxyapi.key to workspace"
fi

HOST_OPENCODE_JSON="${CONFIG_DIR}/opencode.json"
HOST_AGENTS_DIR="${CONFIG_DIR}/agents"
TENANT_OPENCODE_JSON="${XDG_CONFIG_DIR}/opencode.json"
TENANT_AGENTS_DIR="${XDG_CONFIG_DIR}/agents"
TENANT_CLIPROXYAPI_KEY_REF=""

if [[ -f "$HOST_CLIPROXYAPI_KEY" ]]; then
  TENANT_CLIPROXYAPI_KEY_REF="{file:/workspace/.config/opencode/cliproxyapi.key}"
fi

GODMODE_LOCAL_API_KEY=$(node -e '
const fs = require("fs");
const [src, dst, cliproxyApiBaseUrl, cliproxyApiKeyRef] = process.argv.slice(1);
let host = {};
if (fs.existsSync(src)) {
  host = JSON.parse(fs.readFileSync(src, "utf8"));
}

// Start with only the host fields the tenant config is allowed to keep.
const config = {};

if (typeof host.model === "string") {
  config.model = host.model;
}

if (host.provider && typeof host.provider === "object") {
  config.provider = { ...host.provider };
}

// Map host plugin paths to container paths
if (Array.isArray(host.plugin)) {
  config.plugin = host.plugin.map(p => {
    if (typeof p === "string" && p.includes("/plugin/cliproxy-api")) {
      return "/opencode-plugins/cliproxy-api";
    }
    return p;
  });
}

// Ensure skills object exists and set paths for container
if (!config.skills) config.skills = {};
config.skills.paths = ["/state/skills"];

// Ensure provider object exists
if (!config.provider) config.provider = {};

// Update cliproxyapi provider options
if (!config.provider.cliproxyapi) {
  config.provider.cliproxyapi = {
    npm: "@ai-sdk/openai-compatible",
    name: "CliProxyApi",
    options: {},
  };
}

const cliproxy = config.provider.cliproxyapi;
if (!cliproxy.options) cliproxy.options = {};

// Fix apiKey path for container environment
if (typeof cliproxy.options.apiKey === "string") {
  // Replace ~/.config/opencode/ with /workspace/.config/opencode/
  cliproxy.options.apiKey = cliproxy.options.apiKey.replace(
    /^\{file:~\/\.config\/opencode\/(.+)\}$/,
    "{file:/workspace/.config/opencode/$1}"
  );
} else if (cliproxyApiKeyRef) {
  cliproxy.options.apiKey = cliproxyApiKeyRef;
}

// Ensure baseURL is set
cliproxy.options.baseURL = cliproxyApiBaseUrl;

// Ensure local provider exists (for fallback)
if (!config.provider.local) {
  config.provider.local = {
    npm: "@ai-sdk/openai-compatible",
    name: "Local Gemma4",
    options: {
      baseURL: "http://192.168.2.166:18080/v1",
    },
    models: {
      gemma4: {
        name: "Gemma 4 26b",
        attachment: true,
        limit: {
          context: 128000,
          output: 32000,
        },
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
      },
    },
  };
}

// Generate local API key for godmode provider (OpenCode requires apiKey for all providers)
let godmodeLocalApiKey = "godmode-" +
  Math.random().toString(36).substring(2, 15) +
  Math.random().toString(36).substring(2, 15) +
  Math.random().toString(36).substring(2, 15);

// Ensure godmode provider exists (prefill proxy runs INSIDE container at 127.0.0.1:8318)
if (!config.provider.godmode) {
  config.provider.godmode = {
    npm: "@ai-sdk/openai-compatible",
    name: "Godmode (Prefill Proxy)",
    options: {
      baseURL: "http://127.0.0.1:8318/v1",
      apiKey: godmodeLocalApiKey,
    },
    models: {
      "deepseek-v4-flash-free": {
        name: "🔬 DeepSeek V4 Flash Free — Zen",
        reasoning: true,
        attachment: true,
        limit: { context: 131072, output: 32768 },
        modalities: { input: ["text"], output: ["text"] }
      },
      "big-pickle": {
        name: "🔬 Big Pickle — Zen",
        attachment: true,
        limit: { context: 131072, output: 32768 },
        modalities: { input: ["text"], output: ["text"] }
      }
    },
  };
} else {
  // Provider already exists — ensure apiKey is set
  if (!config.provider.godmode.options) config.provider.godmode.options = {};
  if (!config.provider.godmode.options.apiKey) {
    config.provider.godmode.options.apiKey = godmodeLocalApiKey;
  } else {
    godmodeLocalApiKey = config.provider.godmode.options.apiKey;
  }
}

// Ensure baseURL is always the local proxy
config.provider.godmode.options.baseURL = "http://127.0.0.1:8318/v1";

// Ensure Zen models are in godmode provider
const gm = config.provider.godmode;
if (!gm.models) gm.models = {};
if (!gm.models["deepseek-v4-flash-free"]) {
  gm.models["deepseek-v4-flash-free"] = {
    name: "🔬 DeepSeek V4 Flash Free — Zen",
    reasoning: true,
    attachment: true,
    limit: { context: 131072, output: 32768 },
    modalities: { input: ["text"], output: ["text"] }
  };
}
if (!gm.models["big-pickle"]) {
  gm.models["big-pickle"] = {
    name: "🔬 Big Pickle — Zen",
    attachment: true,
    limit: { context: 131072, output: 32768 },
    modalities: { input: ["text"], output: ["text"] }
  };
}

// Set default model to godmode/deepseek-v4-flash-free (Zen free tier)
if (!config.model || config.model === "cliproxyapi/claude-sonnet-4-20250514") {
  config.model = "godmode/deepseek-v4-flash-free";
}

fs.writeFileSync(dst, JSON.stringify(config, null, 2) + "\n", "utf8");

// Output the local API key so bash can pass it to the container
process.stdout.write(godmodeLocalApiKey);
 ' "$HOST_OPENCODE_JSON" "$TENANT_OPENCODE_JSON" "$CLIPROXYAPI_BASE_URL" "$TENANT_CLIPROXYAPI_KEY_REF")

echo "Generated godmode local API key: ${GODMODE_LOCAL_API_KEY:0:20}..."

# Install base skills (tg-cli, openai-media-transcriber, gpt-image-api, tg-uploader, yandex-rasp, install-vpn, gui-automation, maps)
if [ -f "$SCRIPT_DIR/vendor/python-tg-cli/SKILL.md" ]; then
  cp "$SCRIPT_DIR/vendor/python-tg-cli/SKILL.md" "$STATE_SKILLS_DIR/tg-cli/SKILL.md"
fi
if [ -f "$SCRIPT_DIR/skills/openai-media-transcriber/SKILL.md" ]; then
  cp "$SCRIPT_DIR/skills/openai-media-transcriber/SKILL.md" \
    "$STATE_SKILLS_DIR/openai-media-transcriber/SKILL.md"
fi
if [ -d "$SCRIPT_DIR/skills/gpt-image-api" ]; then
  cp -R "$SCRIPT_DIR/skills/gpt-image-api/." "$STATE_SKILLS_DIR/gpt-image-api/"
fi
if [ -d "$SCRIPT_DIR/skills/tg-uploader" ]; then
  mkdir -p "$STATE_SKILLS_DIR/tg-uploader"
  cp -R "$SCRIPT_DIR/skills/tg-uploader/." "$STATE_SKILLS_DIR/tg-uploader/"
fi
if [ -f "$SCRIPT_DIR/skills/yandex-rasp/SKILL.md" ]; then
  mkdir -p "$STATE_SKILLS_DIR/yandex-rasp"
  cp "$SCRIPT_DIR/skills/yandex-rasp/SKILL.md" "$STATE_SKILLS_DIR/yandex-rasp/SKILL.md"
fi
if [ -f "$SCRIPT_DIR/skills/install-vpn/SKILL.md" ]; then
  mkdir -p "$STATE_SKILLS_DIR/install-vpn"
  cp "$SCRIPT_DIR/skills/install-vpn/SKILL.md" "$STATE_SKILLS_DIR/install-vpn/SKILL.md"
fi
if [ -f "$SCRIPT_DIR/skills/gui-automation/SKILL.md" ]; then
  mkdir -p "$STATE_SKILLS_DIR/gui-automation"
  cp "$SCRIPT_DIR/skills/gui-automation/SKILL.md" "$STATE_SKILLS_DIR/gui-automation/SKILL.md"
  if [ -f "$SCRIPT_DIR/skills/gui-automation/gui_automation.py" ]; then
    cp "$SCRIPT_DIR/skills/gui-automation/gui_automation.py" "$STATE_SKILLS_DIR/gui-automation/gui_automation.py"
  fi
fi
if [ -f "$SCRIPT_DIR/opencode-skills-pkg/maps/SKILL.md" ]; then
  mkdir -p "$STATE_SKILLS_DIR/maps/scripts"
  cp "$SCRIPT_DIR/opencode-skills-pkg/maps/SKILL.md" "$STATE_SKILLS_DIR/maps/SKILL.md"
  cp "$SCRIPT_DIR/opencode-skills-pkg/maps/scripts/maps_client.py" "$STATE_SKILLS_DIR/maps/scripts/maps_client.py"
  echo "Installed maps skill"
fi
# Install godmode skill (GODMODE CLASSIC + Parseltongue + ULTRAPLINIAN)
if [ -f "$SCRIPT_DIR/opencode-skills-pkg/godmode/SKILL.md" ]; then
  mkdir -p "$STATE_SKILLS_DIR/godmode/"{references,templates,scripts}
  cp "$SCRIPT_DIR/opencode-skills-pkg/godmode/SKILL.md" "$STATE_SKILLS_DIR/godmode/SKILL.md"
  cp "$SCRIPT_DIR/opencode-skills-pkg/godmode/references/"*.md "$STATE_SKILLS_DIR/godmode/references/" 2>/dev/null || true
  cp "$SCRIPT_DIR/opencode-skills-pkg/godmode/templates/"*.json "$STATE_SKILLS_DIR/godmode/templates/" 2>/dev/null || true
  cp "$SCRIPT_DIR/opencode-skills-pkg/godmode/scripts/"*.py "$STATE_SKILLS_DIR/godmode/scripts/" 2>/dev/null || true
  cp "$SCRIPT_DIR/opencode-skills-pkg/godmode/scripts/"*.md "$STATE_SKILLS_DIR/godmode/scripts/" 2>/dev/null || true
  echo "Installed godmode skill"
fi
# Install file-server (Hermes-ported file delivery)
if [ -f "$SCRIPT_DIR/skills/file-server/file-server.py" ]; then
  mkdir -p "$STATE_SKILLS_DIR/file-server"
  cp "$SCRIPT_DIR/skills/file-server/file-server.py" "$STATE_SKILLS_DIR/file-server/file-server.py"
  # Also symlink to /usr/local/bin for easy access
  ln -sf "$STATE_SKILLS_DIR/file-server/file-server.py" /usr/local/bin/file-server.py 2>/dev/null || true
  echo "Installed file-server"
fi

# Install all skills from the baked-in package (opencode-skills-pkg).
# When running on the host (non-Docker mode), the skills/ subdirectory may not
# exist in the host copy of the package — that's fine, base skills are already
# installed separately above. Inside Docker, /usr/local/lib/opencode-skills-pkg
# has the full skills tree.
if [ -d "$SCRIPT_DIR/opencode-skills-pkg" ]; then
  bash "$SCRIPT_DIR/bin/install-opencode-skills.sh" \
    --source "$SCRIPT_DIR/opencode-skills-pkg" \
    --target "$STATE_SKILLS_DIR" || true
fi

cat > "$STATE_DIR/MAP.md" <<'EOF'
# Tenant State Map

This tenant has two sibling directories:

- `/workspace` - the user's working project directory.
- `/state` - personal runtime state and support files that are not part of the project itself.

Directory map:

- `/state/opencode` (materialized at `/state/share/opencode`) - persistent OpenCode data for this tenant.
- `/state/tg-cli` - persistent Telegram CLI config and session data.
- `/state/config` - XDG config home for tenant-specific tools.
- `/state/cache` - persistent cache data for this tenant.
- `/state/xdg-state` - persistent state files for tools that use XDG state.
- `/state/skills` - tenant-visible skills and skill-related files kept outside the project tree.

Skills installed in `/state/skills`:

- `tg-cli` — Telegram CLI operations (chat list, message search, media export)
- `openai-media-transcriber` — Media transcription via container proxy
- `gpt-image-api` — Image generation via container proxy
- `concept-diagrams` — Flat minimal SVG diagrams as HTML
- `blender-mcp` — Control Blender via socket
- `docker-management` — Docker container, image, volume management
- `pinggy-tunnel` — Zero-install localhost tunnels over SSH
- `watchers` — Poll RSS, JSON APIs, GitHub with watermark dedup
- `inference-sh-cli` — Run 150+ AI apps via inference.sh CLI
- `web-pentest` — Authorized web app penetration testing
- `sherlock` — OSINT username search across 400+ social networks
- `osint-investigation` — Public-records OSINT (SEC, USAspending, OFAC)
- `parallel-cli` — Web search, extraction, deep research via Parallel.ai
- `bioinformatics` — Gateway to 400+ bio skills (genomics, variant calling)
- `antigravity-cli` — Operate Antigravity CLI (agy)
- `chroma` — Open-source embedding DB
- `whisper` — OpenAI Whisper speech recognition
- `torchtitan` — Distributed LLM pretraining
- `clip` — OpenAI CLIP zero-shot image classification
- `screen-manager` — Xvfb virtual display, xdotool/wmctrl
- `visual-browser` — Chromium via CDP + Playwright
- `screenshot` — Screenshots via CDP, Playwright, scrot
- `one-three-one-rule` — Decision framework: 1 problem → 3 options → 1 recommendation
- `tg-uploader` — Send files/text/Telegraph articles to Telegram chats
- `yandex-rasp` — Yandex Rasp API: train/suburban schedules, MiniApp ticket links
- `install-vpn` — VPN setup: Tailscale, AmneziaWG, 3x-ui (VLESS+XHTTP+REALITY)
- `gui-automation` — GUI automation: Bezier mouse, CAPTCHA solving, anti-detection patterns
- `maps` — Geocoding, POI search, routing, timezones via OpenStreetMap/Nominatim/OSRM. Commands: search, reverse, nearby, distance, directions, timezone, area, bbox. Zero API keys. Script at /state/skills/maps/scripts/maps_client.py
- `godmode` — Jailbreak LLMs via GODMODE CLASSIC (5 templates), Parseltongue (33 obfuscation techniques), and ULTRAPLINIAN (55-model racing). Requires OPENROUTER_API_KEY env var. References at /state/skills/godmode/references/. Templates at /state/skills/godmode/templates/.

Full catalog at `/usr/local/lib/opencode-skills-pkg/registry/catalog.json` (inside container).

Model guidance:

- Keep project files in `/workspace`.
- Keep non-project runtime artifacts in `/state`.
- When asked to install, inspect, or explain skills, check `/state/MAP.md` and `/state/skills` first.
- Do not create tool caches, auth files, or skill files inside `/workspace` unless the user explicitly asks for that layout.
EOF

cat > "$WORKSPACE/AGENTS.md" <<'EOF'
# AGENTS.md

You are the user's personal Telegram assistant.

## Mission
- Help the user manage Telegram chats, messages, sessions, and local Telegram data.
- Keep responses terse and actionable.
- Do not narrate internal tool calls or transient recoverable issues unless the user needs them.
- Read `/state/MAP.md` before deciding where to place runtime files, skills, caches, auth artifacts, or temporary support files.

## Telegram capabilities
Use `/usr/local/bin/opencode-tg-cli` for Telegram operations in this workspace.

### Auth and session management
- Check login with `status` or `whoami`.
- Refresh local state with `refresh` before analysis commands when needed.
- Use `session export` and `session import` only if the installed tg-cli build exposes them.

### Chat and data operations
- List chats with `chat list`.
- Search messages with `message search`.
- Send messages with `message send`.
- Sync and inspect local state with `refresh`, `sync-all`, `listen`, and `listen --persist`.
- Use the new background sync flow to keep the cache current without blocking the user.

### Analysis and export
- Treat each dialog like a long-running session with derived summaries, facts, evidence, and compaction.
- Keep raw messages, edits, deletions, forwards, reads, reactions, and media provenance available for analysis.
- Use media export filters, time ranges, and scope-based export when the user wants a slice of history instead of the whole archive.
- Save downloaded media under the workspace `media/` directory next to the DB / JSON exports.
- Use embeddings and retrieval helpers when they improve recall, but keep derived state rebuildable from raw history.

### Media and live ingestion
- Download incoming voice and video_note messages when they matter.
- Transcribe voice/video_note through the configured local STT endpoint.
- Deliver useful transcripts back to the user without flooding the chat with intermediate status.
- Preserve transcript metadata so the source message and file path remain traceable.

## Working style
- Prefer the shortest viable path for auth/login.
- Ask only for the next missing value when a flow requires user input.
- Preserve raw Telegram data and keep derived analysis rebuildable.
- You may browse the internet, install skills, and run programs when they help complete the user's request.

## Filesystem layout
- `/workspace` is the user-facing project directory.
- `/state` stores personal runtime data outside the project tree.
- `/state/skills` is the preferred place for tenant-visible installed skills and related support files.
- If the user asks to install a skill, inspect `/state/MAP.md` first so you do not place it inside the project by mistake.
EOF

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Docker image not found: $IMAGE" >&2
  echo "Build it first:" >&2
  echo "  docker build -t $IMAGE \"$SCRIPT_DIR\"" >&2
  exit 1
fi

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

SELECTED_HOST_PORT="$(select_free_host_port "$HOST_PORT")" || {
  echo "No free host port found in range 49600-49999" >&2
  exit 1
}

if [[ "$SELECTED_HOST_PORT" != "$HOST_PORT" ]]; then
  echo "Preferred HOST_PORT ${HOST_PORT} is busy; using ${SELECTED_HOST_PORT} instead"
fi

HOST_PORT="$SELECTED_HOST_PORT"

echo "Starting opencode serve on 0.0.0.0:${HOST_PORT}"
echo "Tenant root: ${TENANT_ROOT}"
echo "Workspace: ${WORKSPACE}"
echo "State dir: ${STATE_DIR}"
echo "Tenant user: ${TG_ID}"
echo "Tenant chat: ${TG_CHAT_ID}"
echo "Tenant id: ${TG_TENANT_ID}"
echo "Server username: ${SERVER_USERNAME}"
echo "Telegram data dir: ${TG_CLI_DIR}"
echo "Docker image: ${IMAGE}"
echo "OpenCode config dir: ${CONFIG_DIR}"

TTY_FLAGS=(-d --restart=unless-stopped)
POST_RUN_CMD="wait"
if [[ -t 0 && -t 1 ]]; then
  TTY_FLAGS=(-it --rm)
  POST_RUN_CMD=""
fi

docker run "${TTY_FLAGS[@]}" \
  -p "0.0.0.0:${HOST_PORT}:${CONTAINER_PORT}" \
  --add-host host.docker.internal:host-gateway \
  -e HOME=/workspace \
  -e XDG_CONFIG_HOME=/state/config \
  -e XDG_CACHE_HOME=/state/cache \
  -e XDG_STATE_HOME=/state/xdg-state \
  -e XDG_DATA_HOME=/state/share \
  -e OPENCODE_CONFIG_DIR=/bootstrap/opencode-config \
  -e OPENCODE_DISABLE_EXTERNAL_SKILLS=true \
  -e OPENCODE_SERVER_USERNAME="${SERVER_USERNAME}" \
  -e OPENCODE_SERVER_PASSWORD="${SERVER_PASSWORD}" \
  -e TG_API_ID="${TG_API_ID}" \
  -e TG_API_HASH="${TG_API_HASH}" \
  -e GEMINI_MEDIA_MODEL="${GEMINI_MEDIA_MODEL}" \
  -e GPT_IMAGE_MODEL="${GPT_IMAGE_MODEL}" \
  -e TG_CONFIG_DIR="/state/tg-cli" \
  -e CLIPROXYAPI_BASE_URL="${CLIPROXYAPI_BASE_URL}" \
  -e CLIPROXYAPI_KEY_FILE="/workspace/.config/opencode/cliproxyapi.key" \
  -e GODMODE_LOCAL_API_KEY="${GODMODE_LOCAL_API_KEY}" \
  -e TELEGRAPH_ENABLED="${TELEGRAPH_ENABLED}" \
  -e TELEGRAPH_ACCESS_TOKEN="${TELEGRAPH_ACCESS_TOKEN}" \
  -e TELEGRAPH_AUTHOR_NAME="${TELEGRAPH_AUTHOR_NAME}" \
  -v "${XDG_CONFIG_DIR}:/bootstrap/opencode-config:ro" \
  -v "${HOST_AUTH_FILE}:/bootstrap/opencode-auth/auth.json:ro" \
  -v "${GEMINI_MEDIA_ENV_FILE}:/run/opencode-secrets/gemini-media.env:ro" \
  -v "${GPT_IMAGE_ENV_FILE}:/run/opencode-secrets/gpt-image.env:ro" \
  -v "${WORKSPACE}:/workspace" \
  -v "${STATE_DIR}:/state" \
  -v "${GLOBAL_AGENTS_FILE}:/etc/opencode/AGENTS.md:ro" \\
  -v "${HOST_AGENTS_DIR}:/bootstrap/opencode-config/agents:ro" \\
  -v "${CONFIG_DIR}/plugin/cliproxy-api:/opencode-plugins/cliproxy-api" \\
  -w /workspace \
  --name "$CONTAINER_NAME" \
  "$IMAGE" \
  serve --hostname 0.0.0.0 --port 4096

if [[ -n "$POST_RUN_CMD" ]]; then
  docker wait "$CONTAINER_NAME" >/dev/null 2>&1
fi
