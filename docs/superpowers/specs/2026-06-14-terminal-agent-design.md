# Terminal Agent — Simplified PTY Terminal (telminal approach)

**Date:** 2026-06-14  
**Status:** Approved (v2 — simplified)  
**Author:** AI agent + Лев

## Problem

Previous design had overengineered Unix socket + JSON protocol. telminal (github.com/fristhon/telminal) shows a simpler approach: the terminal agent is spawned via a pipe, stdin/stdout carry text directly. No JSON, no socket server.

## Goal

Simple terminal in Telegram for VM users:
1. **PTY terminal** — interactive shell via `node-pty` spawned through SSH pipe
2. **Text-only output** — no Puppeteer on VM, text forwarded via SSH stdout
3. **Optional screenshots** — rendered on host via Puppeteer + xterm.js (Phase 2)
4. **Media watcher** — file auto-upload via chokidar (Phase 3)

## Architecture

```
User → Telegram Bot (host)
         ↓
    VMPtyBridge (SSH pipe)
         ↓
    ssh opencode@<bridgeIp> node /opt/terminal-agent.js <sessionId> <cols> <rows>
         ↓  (stdin pipe → forward user text)
    terminal-agent.js on VM
         ↓  (node-pty spawn bash)
         ↓  (stdout pipe → PTY output)
    VMPtyBridge reads output → sends to Telegram
```

## Components

### 1. Terminal Agent (`src/vm/terminal-agent.ts`)

A tiny Node.js script on the VM deployed to `/opt/terminal-agent.js`.

**Input:** `node /opt/terminal-agent.js <sessionId> <cols> <rows> [cwd]`

**Behavior:**
```javascript
const pty = require('node-pty');
const [sessionId, cols, rows, cwd] = process.argv.slice(2);

const term = pty.spawn('bash', ['--login'], {
  name: 'xterm-256color',
  cols: parseInt(cols) || 80,
  rows: parseInt(rows) || 24,
  cwd: cwd || '/workspace',
  env: { ...process.env, TERM: 'xterm-256color' },
});

// Forward PTY output to stdout (goes to bot via SSH pipe)
term.onData((data: string) => process.stdout.write(data));

// Forward stdin to PTY (user text from bot)
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data: string) => {
  // ^C → SIGINT
  if (data === '\x03') { term.kill('SIGINT'); return; }
  // ^D → EOF
  if (data === '\x04') { process.stdin.pause(); return; }
  term.write(data);
});
process.stdin.resume();

// On exit, write exit marker and quit
term.onExit(({ exitCode, signal }) => {
  process.stdout.write(`\n[Exited with code ${exitCode}]\n`);
  process.exit(exitCode ?? 0);
});
```

**Dependencies:** `node-pty` (npm, pre-installed on VM)

### 2. PTY Bridge (`src/bot/commands/terminal-bridge.ts`)

**VMPtyBridge** — manages SSH child processes that tunnel terminal I/O.

```typescript
class VMPtyBridge {
  constructor(bridgeIp: string);
  spawnSession(sessionId: string, opts?: { cols?: number; rows?: number; cwd?: string }): PtySessionHandle;
  killAll(): void;
}

interface PtySessionHandle {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number | null) => void) => void;
}
```

`spawnSession`:
1. Spawns: `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null opencode@<bridgeIp> node /opt/terminal-agent.js <sessionId> <cols> <rows> [cwd]`
2. Returns handle with write/resize/kill
3. Reads stdout and emits via `onData` callback
4. On `close` → emits `onExit`

`write(data)` → writes to ssh child's stdin
`resize(cols, rows)` → sends SIGWINCH via `kill -SIGWINCH <pid>` on VM
`kill(signal)` → kills ssh child process (terminates PTY)

### 3. Integration with terminal.ts

New exports in `src/bot/commands/terminal.ts`:

```typescript
export async function ensureVMPtyBridge(userId: number, bridgeIp: string): Promise<VMPtyBridge>;
export function getPtySession(messageThreadId: number): PtySessionHandle | undefined;
export function setPtySession(messageThreadId: number, session: PtySessionHandle): void;
export async function killPtySession(messageThreadId: number): Promise<void>;
export async function disconnectVMBridge(userId: number): Promise<void>;
```

### 4. Integration with index.ts

In the terminal text handler, when `getPtySession(mtId)` returns a session:
- Write text directly to PTY (append `\n` unless `^C`/`^D` prefix)
- Output is collected asynchronously and edited into the status message

### 5. `/terminal` command flow

1. User sends `/terminal` or clicks Terminal button
2. `openTerminalTopic` creates forum topic + OpenCode session
3. For VM users: `ensureVMPtyBridge` → `bridge.spawnSession()` → PTY running
4. Session handle stored via `setPtySession(messageThreadId, handle)`
5. Welcome message sent with system info
6. Any text in the topic → forwarded to PTY

## Dependencies (on VM)

- `node-pty` — PTY pseudo-terminal (npm)
- Node.js 20+ — already present

## Files

| File | Change |
|------|--------|
| `src/vm/terminal-agent.ts` | NEW — Terminal agent (pipe-based, no socket) |
| `src/bot/commands/terminal-bridge.ts` | NEW — VMPtyBridge (SSH pipe manager) |
| `src/bot/commands/terminal.ts` | ADD — exports for bridge manager, session map |
| `src/bot/index.ts` | ADD — PTY path in terminal handler |
| `src/vm/cloud-init.ts` | ADD — node-pty install + agent deployment |
| `build-golden.sh` | ADD — same as cloud-init |
| `tests/vm/terminal-agent.test.ts` | NEW |
| `tests/bot/commands/terminal-bridge.test.ts` | NEW |
| `tests/bot/commands/terminal-pty.test.ts` | NEW |
| `tests/bot/index-terminal-pty.test.ts` | NEW |

## Rollout Plan

1. **Phase 1:** Terminal agent + PTY bridge + basic terminal (spawn, write, data, kill)
2. **Phase 2:** Screenshots (`/screen`) via Puppeteer on host
3. **Phase 3:** Media watcher (chokidar)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| node-pty compilation on VM | Pre-install in golden image |
| SSH connection drops | Auto-reconnect on next message |
| Orphaned PTY on SSH disconnect | SSH child process kill → PTY tree killed by OS |
| Large output → Telegram limit | Truncate to last 3800 chars, send `...truncated` marker |
