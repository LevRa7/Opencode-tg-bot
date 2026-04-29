# OpenCode + tg-cli Docker Server

This directory contains a Docker-based OpenCode server setup with isolated Telegram CLI support.

The setup provides:

- OpenSSH client tools inside the container for tenant workspace access
- OpenCode server running in Docker
- `tg-cli` installed in the same container
- one workspace per tenant
- one OpenCode database per workspace
- one Telegram session/config directory per workspace
- automatic fallback to the next free published port when the preferred port is already used by another server container
- shared global Telegram app credentials
- access from the container to the host `cliproxyapi` endpoint
- a minimal tenant-specific OpenCode config instead of inheriting the full host config
- only the explicitly copied `tg-cli` and `embedding-strategies` skills inside the isolated session
- local-only publishing on `127.0.0.1`
- local vendored build inputs so rebuilds do not need Docker Hub

## Important directory separation

This directory belongs to your Telegram bot project:

```text
/home/me/MyProjects/opencode-tg
```

It is **not** the OpenCode source tree.

This setup now uses:

- a locally cached OpenCode base image already present in Docker
- the local vendored `tg-cli` source tree from this directory

So future rebuilds do not need Docker Hub as long as the base image remains cached locally.

## Files

- `run-opencode-serve.sh` — starts the server container
- `build-opencode-tg-image.sh` — vendors the local tg-cli source and builds the image
- `update-opencode.sh` — refreshes the Docker images from upstream OpenCode and reruns the Docker checks
- `Dockerfile` — builds the custom image from the locally cached OpenCode base image plus vendored tg-cli
- `bin/tg-cli-wrapper.sh` — wrapper that forces isolated tg-cli config per workspace
- `skills/tg-cli/SKILL.md` — project skill telling OpenCode how to use Telegram CLI
- `tg-cli/` — local tg-cli source from `https://github.com/miolamio/tg-cli`
- `vendor/python-tg-cli/` — vendored tg-cli source used during Docker build
- `README.md` — English instructions
- `README-ru.md` — Russian instructions

## What is isolated and what is shared

### Shared across all ports

These values are global:

- Telegram app `api_id`
- Telegram app `api_hash`
- main OpenCode auth from `~/.local/share/opencode/auth.json`
- host `cliproxyapi` endpoint and the cliproxyapi model catalog copied into the tenant config

The full host OpenCode config is not copied into the container tenant state.

### Isolated per port

If you start the server on `49601`, it uses:

- workspace: `/home/me/Workspaces/49601`
- OpenCode DB: `/home/me/Workspaces/49601/.opencode-data`
- Telegram config/session data: `/home/me/Workspaces/49601/.tg-cli`

If you start the server on `49602`, it gets its own separate:

- `/home/me/Workspaces/49602/.opencode-data`
- `/home/me/Workspaces/49602/.tg-cli`

So Telegram session files are not shared between ports.

## cliproxyapi access from Docker

Your host OpenCode config uses:

```text
http://127.0.0.1:8317/v1
```

Inside Docker, `127.0.0.1` points to the container itself, not the host. In this environment the host LAN address `192.168.2.166:8317` is directly reachable from the container, so the launcher uses that address by default:

```text
http://192.168.2.166:8317/v1
```

You can override it manually with:

```bash
CLIPROXYAPI_BASE_URL='http://192.168.2.166:8317/v1'
```

## Requirements

Before using this setup, make sure the host machine has:

- Docker
- user-level Docker access without `sudo` (rootless Docker or equivalent access to the Docker daemon)
- `/home/me/Workspaces`
- `~/.config/opencode`
- `~/.local/share/opencode/auth.json`
- the host `cliproxyapi` server listening on `127.0.0.1:8317`
- a locally cached Docker image:
  - `ghcr.io/anomalyco/opencode:latest`
- the local `docker/tg-cli` source tree, which gets vendored into the image

## Build the Docker image from local artifacts

Before the first run, build the custom image with the helper script:

```bash
/home/me/MyProjects/opencode-tg/docker/build-opencode-tg-image.sh
```

### What this command does

- checks that the local base image exists:
  - `ghcr.io/anomalyco/opencode:latest`
- vendors the local tg-cli source tree into:
  - `/home/me/MyProjects/opencode-tg/docker/vendor/python-tg-cli`
- runs `docker build -t opencode-tg:local ...`
- builds an image containing:
  - the cached local OpenCode base image
  - the tg-cli command (`tg` and `telegram-cli`)
  - wrapper command `/usr/local/bin/opencode-tg-cli`

### Optional overrides

By default, the script uses `docker/tg-cli` as the tg-cli source tree.

Use a different tg-cli source path:

```bash
TG_CLI_SOURCE_DIR='/path/to/tg-cli' /home/me/MyProjects/opencode-tg/docker/build-opencode-tg-image.sh
```

Use a different cached base image tag:

```bash
OPENCODE_BASE_IMAGE='ghcr.io/anomalyco/opencode:latest' /home/me/MyProjects/opencode-tg/docker/build-opencode-tg-image.sh
```

## Refresh Docker images from upstream OpenCode

When you want to pull in the latest upstream OpenCode build into the Docker workflow, run:

```bash
/home/me/MyProjects/opencode-tg/docker/update-opencode.sh
```

### Prerequisites

This refresh flow expects the local vendored tg-cli source tree to already be present and also requires a local tenant base image, which defaults to `opencode-tenant:latest` and can be overridden with `OPENCODE_TENANT_BASE_IMAGE`.

### What this command does

- clones the upstream OpenCode repository into `docker/.cache/opencode-upstream`
- uses the upstream default branch by default, or `OPENCODE_UPSTREAM_REF` if you want a specific branch or tag
- builds a fresh local OpenCode binary plus the local tg-cli wheel and staging tree used by the Docker images
- rebuilds `opencode-tenant:local`
- rebuilds `opencode-tg:local`
- prints `opencode --version` from both rebuilt images
- runs the Docker verification scripts:
  - `docker/tests/tg-cli-image.test.sh`
  - `docker/tests/tenant-entrypoint-permissions.test.sh`

### Optional override

Pin the upstream source to a specific ref:

```bash
OPENCODE_UPSTREAM_REF='v0.17.0' /home/me/MyProjects/opencode-tg/docker/update-opencode.sh
```

## Script path

```bash
/home/me/MyProjects/opencode-tg/docker/run-opencode-serve.sh
```

## Basic start

```bash
OPENCODE_SERVER_PASSWORD='your-password' /home/me/MyProjects/opencode-tg/docker/run-opencode-serve.sh
```

The helper scripts are designed to run without `sudo`. They prefer the user Docker socket at `${XDG_RUNTIME_DIR}/docker.sock` when available and keep Docker client state in `docker/.docker-config`.

The container root filesystem is writable. Tenant-specific OpenCode, tg-cli, and skill state still lives under `/state`.

## Tenant SSH behavior

The container runs tenant commands with:

```text
HOME=/workspace
```

That means the default tenant SSH directory inside the container is:

```text
/workspace/.ssh
```

Practical consequences:

- SSH keys generated inside the container with tools like `ssh-keygen` stay in that tenant workspace
- existing tenant SSH files can be placed in `/workspace/.ssh`
- you can also point OpenSSH commands at another key path explicitly with `-i /path/to/key`

Because `/workspace` is the tenant bind mount, SSH material created there persists with that tenant workspace across container restarts.

## Start on a specific port

```bash
HOST_PORT=49602 OPENCODE_SERVER_PASSWORD='your-password' /home/me/MyProjects/opencode-tg/docker/run-opencode-serve.sh
```

If that port is already published by another `opencode-serve-*` container, the launcher will use the next free port and print the selected value.

## Global Telegram app credentials

The launcher sets these values by default:

```text
TG_API_ID=29814416
TG_API_HASH=58768c18060fee87a1ce635fefd959ab
```

These are global and shared across all ports.

## How Telegram session isolation works

The wrapper command inside the container is:

```text
/usr/local/bin/opencode-tg-cli
```

It always forces tg-cli to use state-backed directories under `/state/tg-cli`:

```text
/state/tg-cli/workspaces/<TG_ID>/.tg-cli
/state/tg-cli/data/messages.db
```

Each tenant gets its own Telegram auth/session directory and its own cache/database tree.

Typical session location:

```text
/state/tg-cli/workspaces/<TG_ID>/.tg-cli/<TG_ID>.session.string
```

## How OpenCode sees tg-cli

The launcher materializes tenant-visible skills under:

```text
/state/skills/tg-cli/SKILL.md
/state/skills/embedding-strategies/SKILL.md
```

The generated tenant config at `/state/config/opencode.json` points `skills.paths` only to:

```text
/state/skills
```

and the container also runs with `OPENCODE_DISABLE_EXTERNAL_SKILLS=true`, so unrelated project `.claude/skills` and `.agents/skills` are not auto-loaded into the isolated session.

The `tg-cli` skill tells OpenCode to use:

```text
/usr/local/bin/opencode-tg-cli
```

for Telegram-related work instead of touching session files directly.

## First-time Telegram login for a new port

Typical first-time flow:

1. start the server on the target port
2. check auth status
3. either start QR login or phone-code login, or import an existing session
4. reuse that saved session on later runs of the same port

### Check auth status inside the container

```bash
/usr/local/bin/opencode-tg-cli status --yaml
/usr/local/bin/opencode-tg-cli whoami --yaml
```

### Start QR login

```bash
/usr/local/bin/opencode-tg-cli login-qr --json
```

When `--json` is used, the command streams JSONL events while waiting:
- `qr_ready`
- `qr_rotated`
- `password_required`
- `authenticated`

For `qr_ready` and `qr_rotated`, use `png_path` if available, or render a QR from `qr_url`.
If Telegram rotates the token, send the refreshed QR again instead of restarting auth.

### Start phone login

```bash
/usr/local/bin/opencode-tg-cli login-start +15551234567 --yaml
```

The response includes `phone_code_hash`. Keep that exact value for the same login attempt.
Then submit the code from chat:

```bash
/usr/local/bin/opencode-tg-cli login-complete +15551234567 12345 --phone-code-hash <hash> --yaml
```

Do not call `status`, `whoami`, `chats`, or `login-start` again between `login-start` and `login-complete`, or Telegram may issue a new code and invalidate the previous one.

If Telegram asks for 2FA, complete it with:

```bash
/usr/local/bin/opencode-tg-cli login-password --password 'your-password' --yaml
```

### Import an existing session string

```bash
printf '%s' "$TG_SESSION" | /usr/local/bin/opencode-tg-cli session import
```

### Optional interactive fallback inside the container

If you explicitly want a terminal-driven login, you can still open a shell and run the old interactive command:

```bash
docker exec -it opencode-serve-49601 sh
/usr/local/bin/opencode-tg-cli auth login
```

## Connect from the OpenCode client

```bash
opencode attach http://127.0.0.1:49602
```

## Troubleshooting

### Required local base image is missing

Load or pull it once, then future rebuilds can stay local.

### Docker still asks for sudo or is unreachable

These scripts expect Docker access from the current user. If they report that the Docker daemon is not accessible, either start your user Docker daemon or grant this user access to Docker without `sudo`.

### cliproxyapi does not work from the container

Make sure the host service is reachable on `192.168.2.166:8317` from the container.
The launcher uses `http://192.168.2.166:8317/v1` by default.

### Telegram auth is missing on a new port

That is expected.
Each port has its own Telegram session directory, so you must log in once per new workspace or import a session.

### Error after login mentioning `wal_checkpoint`

This script avoids that by storing OpenCode server DB files separately in:

```text
/home/me/Workspaces/<PORT>/.opencode-data
```
