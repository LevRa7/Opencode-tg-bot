ARG TENANT_IMAGE=opencode-tenant:latest
FROM ${TENANT_IMAGE}

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client python3-pip python3-venv python3-wheel-whl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 opencode || true \
  && useradd -m -u 1000 -g 1000 -s /bin/sh opencode || true

RUN groupadd -g 2000 opencode-proxy || true \
  && useradd -M -u 2000 -g 2000 -s /usr/sbin/nologin opencode-proxy || true

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

# Entrypoint wrapper: merge AGENTS.md then exec opencode
COPY bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
