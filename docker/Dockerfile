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

# Entrypoint wrapper: merge AGENTS.md then exec opencode
COPY bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
