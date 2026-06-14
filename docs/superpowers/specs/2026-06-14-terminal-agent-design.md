# Terminal Agent — PTY Terminal with Screenshots and Media Watcher

**Date:** 2026-06-14  
**Status:** Approved  
**Author:** AI agent + Лев

## Problem

Current `/terminal` implementation uses `child_process.spawn()` with `shell: true`. This provides no interactivity (no Ctrl+C, no Tab completion, no arrow keys, no colors). For VM users, commands are wrapped in `ssh ... "cd /workspace && <cmd>"` — a single-shot execution, not a real terminal.

Additionally, there are no screenshots and no auto-upload of generated files.

## Goal

Replace `/terminal` with a full coderBOT-like experience:
1. **PTY terminal** — true interactive shell via `node-pty`
2. **Screenshots** — `/screen` command renders terminal state via Puppeteer
3. **Media watcher** — auto-send files generated in a watched directory

All running on the user's selected deployment target (VM via Unix socket + SSH tunnel, Docker tenant, local host).

## Architecture

```
User → Telegram → Bot (host)
                    ├─ LocalPtyBridge    → node-pty (local host)
                    ├─ DockerPtyBridge   → Docker exec + node-pty
                    └─ VmPtyBridge       → ssh -L + Unix socket → VM agent
                         ↓
                    VM: terminal-agent.js
                         ├─ PTY pool (node-pty spawn)
                         ├─ Screenshot (Puppeteer render)
                         └─ Media watcher (chokidar → /workspace/media)
```

## Components

### 1. Terminal Agent (`src/vm/terminal-agent.ts`)

A standalone Node.js process on the VM. Compiled to JS and placed at `/opt/terminal-agent.js` during golden image build / cloud-init.

**Interface:** Unix socket at `/tmp/opencode-terminal.sock`

**Features:**
- PTY session management (spawn, write, resize, kill)
- Screenshot capture via Puppeteer (headless Chromium)
- Directory watcher via chokidar

**JSON Protocol:**

| Direction | Type | Fields |
|-----------|------|--------|
| Bot → Agent | `spawn` | `id`, `cmd`, `cwd?`, `cols`, `rows` |
| Agent → Bot | `spawned` | `id`, `pid` |
| Bot → Agent | `write` | `id`, `data` |
| Agent → Bot | `data` | `id`, `data` |
| Bot → Agent | `resize` | `id`, `cols`, `rows` |
| Bot → Agent | `kill` | `id` |
| Agent → Bot | `exit` | `id`, `code` |
| Bot → Agent | `screenshot` | `id` |
| Agent → Bot | `screenshot` | `id`, `image` (base64 PNG) |
| Bot → Agent | `watch` | `path` |
| Agent → Bot | `file` | `path`, `size`, `mime` |

Each message is a single JSON line terminated by `\n`.

### 2. PTY Bridge (`src/bot/commands/terminal.ts`)

Abstraction over different deployment targets.

**LocalPtyBridge:** Uses `node-pty` directly on the host.

**VmPtyBridge:** Creates SSH tunnel (`ssh -L <localPort>:/tmp/opencode-terminal.sock -N opencode@<bridgeIp>`) then connects to the forwarded local port via TCP. Communicates via the JSON protocol.

**DockerPtyBridge:** Uses `docker exec` to run `node-pty` inside the tenant container.

### 3. Session Manager

One terminal session = one PTY instance. Tracks:
- `messageThreadId` → PTY session mapping
- Active sessions (for `/screen`, `/close`, Ctrl+C)
- Media watch subscriptions

### 4. Bot Commands

| Command | Behavior |
|---------|----------|
| `/terminal` | Creates terminal topic + starts PTY session on target machine |
| `/screen` | Requests screenshot from agent, sends to chat |
| `/close` | Kills PTY, closes topic |
| Text in terminal topic | Writes to PTY (`\n` appended unless Ctrl+D) |
| `/ctrl <char>` | Sends control character to PTY |
| `/keys <text>` | Sends raw text without Enter |

### 5. Media Watcher

Agent watches `/workspace/media/` (configurable). On new file:
1. Agent sends `file` message with path, size, mime
2. Bot downloads file from VM via SCP
3. Bot sends file to Telegram chat
4. File moved to `/workspace/media/sent/`

## Dependencies (on VM)

- `node-pty` — PTY pseudo-terminal (npm)
- `puppeteer` — screenshot rendering (npm, uses existing chromium)
- `chokidar` — file system watcher (npm)
- Chromium — already installed via golden image (`playwright install-deps chromium`)

## Files Changed

| File | Change |
|------|--------|
| `src/vm/terminal-agent.ts` | **NEW** — Terminal agent source |
| `src/bot/commands/terminal.ts` | Rewrite — PttyBridge, session manager, protocol |
| `src/vm/cloud-init.ts` | Add npm install + agent deployment |
| `build-golden.sh` | Add npm install + agent deployment |
| `tests/bot/commands/terminal.test.ts` | Rewrite tests for PTY protocol |
| `tests/vm/terminal-agent.test.ts` | **NEW** — Agent unit tests |

## Rollout Plan

1. **Phase 1:** Terminal agent + PTY bridge + basic terminal (spawn, write, data, kill)
2. **Phase 2:** Screenshots (`/screen`)
3. **Phase 3:** Media watcher
4. **Phase 4:** Docker bridge, polish

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| node-pty compilation fails on VM | Pre-compile binary in golden image |
| SSH tunnel drops | Auto-reconnect with exponential backoff |
| Puppeteer memory leak | Restart agent periodically (systemd timer) |
| Unix socket permission denied | chmod 0660, owned by opencode user |
