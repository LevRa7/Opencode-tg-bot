ARG TENANT_IMAGE=opencode-tenant:latest
FROM ${TENANT_IMAGE}

USER root

RUN apk add --no-cache \
    python3 py3-pip py3-wheel py3-setuptools py3-virtualenv nodejs npm \
    openssh-client-default util-linux \
    nmap \
    xvfb xdotool scrot \
    imagemagick \
    ffmpeg \
    chromium \
    gcc g++ make python3-dev cmake \
    llvm19-dev \
  && pip3 install --break-system-packages --no-cache-dir whatweb wmctrl samtools bcftools 2>/dev/null || true \
  && ln -sf /bin/setpriv /usr/bin/setpriv

# Install skill dependencies: Python packages (non-GPU)
# Each group is isolated so one failure doesn't block the rest
RUN pip3 install --break-system-packages --no-cache-dir --upgrade pip wheel 'setuptools<76'; \
    pip3 install --break-system-packages --no-cache-dir --prefer-binary \
    openai-whisper 2>/dev/null || echo '[INFO] openai-whisper not installed (no musllinux wheel)'; \
    rm -rf /root/.cache/pip
# Attempt to install chromadb, skip if no wheel available
RUN pip3 install --break-system-packages --no-cache-dir --only-binary=:all: chromadb 2>/dev/null || \
    echo '[INFO] chromadb not installed (no musllinux wheel)'; \
    rm -rf /root/.cache/pip
RUN pip3 install --break-system-packages --no-cache-dir \
    pyfiglet pygount sherlock-project debugpy pymupdf \
    python-pptx biopython pysam comfy-cli huggingface-hub \
    wandb google-api-python-client pillow dspy \
    "parallel-web-tools[cli]" \
  && rm -rf /root/.cache/pip

# Install skill dependencies: Node.js packages (global)
RUN npm install -g \
    better-sqlite3 dotenv express qrcode tsx \
    node-pty \
  && npm cache clean --force 2>/dev/null || true

# Install playwright (browser automation) — skip browser binary download, uses system chromium
RUN npm install -g playwright \
  && npm cache clean --force 2>/dev/null || true

RUN addgroup -g 1000 opencode 2>/dev/null; \
  adduser -D -u 1000 -G opencode -s /bin/sh opencode 2>/dev/null || true

RUN addgroup -g 2000 opencode-proxy 2>/dev/null; \
  adduser -D -u 2000 -G opencode-proxy -s /sbin/nologin opencode-proxy 2>/dev/null || true

COPY vendor/python-tg-cli/src/tg_cli /opt/tg-cli/src/tg_cli
RUN cat > /usr/local/bin/tg <<'EOF'
#!/usr/bin/env sh
set -eu
export PYTHONPATH="/opt/tg-cli/src${PYTHONPATH:+:${PYTHONPATH}}"
exec /usr/bin/python3 -c 'from tg_cli.cli.main import cli; cli(prog_name="tg")' "$@"
EOF
RUN chmod +x /usr/local/bin/tg \
  && ln -sf /usr/local/bin/tg /usr/local/bin/telegram-cli \
  && ln -sf /usr/local/bin/tg /usr/local/bin/tg-cli

COPY bin/tg-cli-wrapper.sh /usr/local/bin/opencode-tg-cli
RUN chmod +x /usr/local/bin/opencode-tg-cli

COPY bin/opencode-gemini-media /usr/local/bin/opencode-gemini-media
RUN chmod +x /usr/local/bin/opencode-gemini-media

COPY bin/gemini-media-proxy.mjs /usr/local/lib/opencode-gemini-media/gemini-media-proxy.mjs

COPY bin/opencode-gpt-image /usr/local/bin/opencode-gpt-image
RUN chmod +x /usr/local/bin/opencode-gpt-image

COPY bin/gpt-image-proxy.mjs /usr/local/lib/opencode-gpt-image/gpt-image-proxy.mjs

COPY bin/ensure-tenant-python-env.sh /usr/local/bin/ensure-tenant-python-env.sh
RUN chmod +x /usr/local/bin/ensure-tenant-python-env.sh

# Whisper STT batch transcription scripts
COPY batch-transcribe.sh /usr/local/bin/batch-transcribe
COPY batch-transcribe.mjs /usr/local/bin/batch-transcribe-node
RUN chmod +x /usr/local/bin/batch-transcribe /usr/local/bin/batch-transcribe-node

# Global AGENTS.md (baked into image, lower priority than user's volume-mounted version)
COPY AGENTS.md /etc/opencode-global/AGENTS.md

# AGENTS.md merge script
COPY bin/merge-agents.sh /usr/local/bin/merge-agents
RUN chmod +x /usr/local/bin/merge-agents

# Skills package (baked into image — all tenants can use it)
COPY opencode-skills-pkg /usr/local/lib/opencode-skills-pkg

# Terminal agent — PTY terminal for VM + Docker tenants
COPY terminal-agent.js /opt/terminal-agent.js
RUN chmod +x /opt/terminal-agent.js

# Skills installer script
COPY bin/install-opencode-skills.sh /usr/local/bin/install-opencode-skills
RUN chmod +x /usr/local/bin/install-opencode-skills

# ── Godmode Toolkit — Python deps ──
RUN pip3 install --break-system-packages --no-cache-dir openai json5

# ── Godmode Toolkit — Prefill Proxy + Installer + Failover ──
# Core proxy: injects GODMODE prefill into every chat completion request
COPY opencode-skills-pkg/godmode/prefill-proxy.py /usr/local/bin/godmode-prefill-proxy
RUN chmod +x /usr/local/bin/godmode-prefill-proxy

# Interactive installer: adds Zen models to godmode provider, creates failover router
COPY opencode-skills-pkg/godmode/install.py /usr/local/bin/godmode-install
RUN chmod +x /usr/local/bin/godmode-install

# Standalone failover router: deepseek-v4-flash-free → big-pickle via prefill proxy
COPY opencode-skills-pkg/godmode/failover.py /usr/local/bin/godmode-failover
RUN chmod +x /usr/local/bin/godmode-failover

# Godmode scripts (race, auto-jailbreak, parseltongue) — standalone copies
COPY opencode-skills-pkg/godmode/scripts/ /usr/local/lib/godmode/scripts/
RUN chmod +x /usr/local/lib/godmode/scripts/*.py

# Godmode templates and references
COPY opencode-skills-pkg/godmode/templates/ /usr/local/lib/godmode/templates/
COPY opencode-skills-pkg/godmode/references/ /usr/local/lib/godmode/references/

# Godmode CLI entrypoint (for container-level godmode management)
RUN cat > /usr/local/bin/godmode-cli <<'PYEOF'
#!/usr/bin/env python3
"""Godmode CLI — start/stop prefill proxy, run installer, test connectivity."""
import sys, os, subprocess, argparse
PROXY_SCRIPT = "/usr/local/bin/godmode-prefill-proxy"
INSTALL_SCRIPT = "/usr/local/bin/godmode-install"
FAILOVER_SCRIPT = "/usr/local/bin/godmode-failover"
def cmd_start(args):
    os.execv(sys.executable, [sys.executable, PROXY_SCRIPT, "--port", str(args.port or 8318), "--prefill", args.mode or "standard", "--bind", args.bind or "0.0.0.0"])
def cmd_stop():
    subprocess.run(["pkill", "-f", "godmode-prefill-proxy"], check=False)
    print("godmode-prefill-proxy stopped")
def cmd_status():
    r = subprocess.run(["pgrep", "-af", "godmode-prefill-proxy"], capture_output=True, text=True)
    if r.stdout.strip():
        print("RUNNING:", r.stdout.strip())
    else:
        print("NOT RUNNING")
def cmd_install(args):
    iargs = [sys.executable, INSTALL_SCRIPT]
    if args.add_zen: iargs.append("--add-zen")
    if args.scan_only: iargs.append("--scan-only")
    if args.no_add: iargs.append("--no-add")
    if args.config: iargs.extend(["--config", args.config])
    if args.test: iargs.extend(["--test", args.test])
    subprocess.run(iargs)
def cmd_failover(args):
    fargs = [sys.executable, FAILOVER_SCRIPT]
    if args.json: fargs.append("--json")
    if args.query: fargs.append(args.query)
    subprocess.run(fargs, input=(args.query or "").encode() if not sys.stdin.isatty() else None)
def main():
    p = argparse.ArgumentParser(description="Godmode CLI — manage prefill proxy, installer, failover")
    sp = p.add_subparsers(dest="command")
    sp_start = sp.add_parser("start", help="Start prefill proxy")
    sp_start.add_argument("--port", type=int, default=8318)
    sp_start.add_argument("--mode", choices=["standard","subtle","none"], default="standard")
    sp_start.add_argument("--bind", default="0.0.0.0")
    sp.add_parser("stop", help="Stop prefill proxy")
    sp.add_parser("status", help="Check prefill proxy status")
    sp_install = sp.add_parser("install", help="Run godmode installer")
    sp_install.add_argument("--add-zen", action="store_true")
    sp_install.add_argument("--scan-only", action="store_true")
    sp_install.add_argument("--no-add", action="store_true")
    sp_install.add_argument("--config")
    sp_install.add_argument("--test")
    sp_fail = sp.add_parser("failover", help="Run failover router")
    sp_fail.add_argument("--json", action="store_true")
    sp_fail.add_argument("query", nargs="?")
    args = p.parse_args()
    if args.command == "start": cmd_start(args)
    elif args.command == "stop": cmd_stop()
    elif args.command == "status": cmd_status()
    elif args.command == "install": cmd_install(args)
    elif args.command == "failover": cmd_failover(args)
    else: p.print_help()
if __name__ == "__main__": main()
PYEOF
RUN chmod +x /usr/local/bin/godmode-cli

# ── TG-Agent (default agent mode for Telegram) ──
# Baked-in agent definition — applied when no custom agent exists in tenant config
RUN mkdir -p /usr/local/lib/opencode-agents
COPY opencode-skills-pkg/godmode/agent-mode.json /usr/local/lib/opencode-agents/agent-mode.json
# tg-agent.md is copied from the shared agents directory below
COPY agents/tg-agent.md /usr/local/lib/opencode-agents/tg-agent.md 2>/dev/null || \
  echo "tg-agent.md not found — using embedded definition"

# ── Container-level godmode auto-setup script ──
RUN cat > /usr/local/bin/godmode-auto-setup <<'SHEOF'
#!/bin/sh
# Auto-setup godmode on first boot: adds Zen models to godmode provider if prefill proxy is reachable.
set -eu
GODMODE_CONFIG="${XDG_CONFIG_HOME:-/state/config}/opencode.json"
if [ ! -f "$GODMODE_CONFIG" ]; then
  echo "[godmode-auto-setup] No opencode.json found at $GODMODE_CONFIG — skipping"
  exit 0
fi
# Check if prefill proxy is running
if ! curl -s --connect-timeout 3 "http://127.0.0.1:8318/v1/models" > /dev/null 2>&1; then
  echo "[godmode-auto-setup] Prefill proxy not reachable — skipping auto-setup"
  exit 0
fi
echo "[godmode-auto-setup] Prefill proxy reachable — running installer..."
exec python3 /usr/local/bin/godmode-install --add-zen --config "$GODMODE_CONFIG"
SHEOF
RUN chmod +x /usr/local/bin/godmode-auto-setup

# Entrypoint wrapper: merge AGENTS.md then exec opencode
COPY bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
