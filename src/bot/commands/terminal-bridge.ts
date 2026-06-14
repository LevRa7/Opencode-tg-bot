// VMPtyBridge — SSH pipe bridge to terminal agent on VM
// Spawns: ssh opencode@<bridgeIp> node /opt/terminal-agent.js <sessionId> <cols> <rows> [cwd]
// Returns PtySessionHandle with write/resize/kill/onData/onExit

import { spawn } from "child_process";
import { logger } from "../../utils/logger.js";

export interface PtySessionHandle {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number | null, signal?: string) => void): void;
}

export class VMPtyBridge {
  private bridgeIp: string;
  private sessions: Map<string, PtySessionHandle> = new Map();

  constructor(bridgeIp: string) {
    this.bridgeIp = bridgeIp;
  }

  spawnSession(sessionId: string, opts?: { cols?: number; rows?: number; cwd?: string }): PtySessionHandle {
    const cols = opts?.cols ?? 80;
    const rows = opts?.rows ?? 24;
    const cwd = opts?.cwd ?? "/workspace";

    const sshArgs = [
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "ConnectTimeout=5",
      `opencode@${this.bridgeIp}`,
      `node /opt/terminal-agent.js ${sessionId} ${cols} ${rows} ${cwd}`,
    ];

    const child = spawn("ssh", sshArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const dataCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<(code: number | null, signal?: string) => void> = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      for (const cb of dataCallbacks) {
        try { cb(data); } catch { /* swallow */ }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      for (const cb of dataCallbacks) {
        try { cb(data); } catch { /* swallow */ }
      }
    });

    child.on("close", (code: number | null, signal: string | null) => {
      for (const cb of exitCallbacks) {
        try { cb(code, signal ?? undefined); } catch { /* swallow */ }
      }
      this.sessions.delete(sessionId);
    });

    child.on("error", (err: Error) => {
      logger.error(`[VMPtyBridge] SSH error for session ${sessionId}:`, err);
      for (const cb of exitCallbacks) {
        try { cb(null, "error"); } catch { /* swallow */ }
      }
      this.sessions.delete(sessionId);
    });

    const handle: PtySessionHandle = {
      id: sessionId,
      write(data: string) {
        if (child.stdin && !child.killed) {
          child.stdin.write(data);
        }
      },
      resize(_newCols: number, _newRows: number) {
        if (!child.killed) {
          (child.kill as any)("SIGWINCH");
        }
      },
      kill(signal?: string) {
        (child.kill as any)(signal ?? "SIGTERM");
      },
      onData(callback: (data: string) => void) {
        dataCallbacks.push(callback);
      },
      onExit(callback: (code: number | null, signal?: string) => void) {
        exitCallbacks.push(callback);
      },
    };

    this.sessions.set(sessionId, handle);
    logger.info(`[VMPtyBridge] Session ${sessionId} spawned on ${this.bridgeIp}`);
    return handle;
  }

  getSession(sessionId: string): PtySessionHandle | undefined {
    return this.sessions.get(sessionId);
  }

  killAll(): void {
    for (const [, session] of this.sessions) {
      try { session.kill(); } catch { /* swallow */ }
    }
    this.sessions.clear();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}
