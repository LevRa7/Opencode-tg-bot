// Terminal Agent — runs on VM via SSH pipe
// Spawned as: node /opt/terminal-agent.js <sessionId> <cols> <rows> [cwd]
// Reads stdin (user input), writes stdout (PTY output).

import { spawn, type IPty } from "node-pty";
import { logger } from "../utils/logger.js";

export interface TerminalAgentSession {
  id: string;
  pty: IPty;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number | null, signal?: string) => void): void;
}

let session: TerminalAgentSession | null = null;

export function createSession(args: {
  sessionId: string;
  cols?: number;
  rows?: number;
  cwd?: string;
}): TerminalAgentSession {
  const { sessionId, cwd } = args;
  const cols = args.cols ?? 80;
  const rows = args.rows ?? 24;

  const pty = spawn("bash", [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: cwd ?? process.cwd(),
  } as any);

  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(code: number | null, signal?: string) => void> = [];

  pty.onData((data: string) => {
    for (const cb of dataCallbacks) {
      try { cb(data); } catch { /* swallow callback errors */ }
    }
  });

  pty.onExit(function (this: any, exitResult: any) {
    // node-pty passes { exitCode, signal? } but test mock passes (code, signal) as two args
    const exitInfo: { exitCode: number; signal?: number } =
      typeof exitResult === "object" && exitResult !== null ? exitResult
      : { exitCode: arguments[0] ?? 0, signal: arguments[1] };
    const code = exitInfo.signal ? null : exitInfo.exitCode;
    for (const cb of exitCallbacks) {
      try { cb(code, exitInfo.signal ? String(exitInfo.signal) : undefined); } catch { /* swallow */ }
    }
    session = null;
  });

  const s: TerminalAgentSession = {
    id: sessionId,
    pty,
    write(data: string) {
      pty.write(data);
    },
    resize(newCols: number, newRows: number) {
      try { pty.resize(newCols, newRows); } catch { /* ignore resize errors */ }
    },
    kill(signal?: string) {
      pty.kill(signal ?? "SIGTERM");
    },
    onData(cb: (data: string) => void) {
      dataCallbacks.push(cb);
    },
    onExit(cb: (code: number | null, signal?: string) => void) {
      exitCallbacks.push(cb);
    },
  };

  session = s;
  logger.info(`[TerminalAgent] Session ${sessionId} created — ${cols}x${rows} @ ${cwd ?? "/workspace"}`);
  return s;
}

export function getSession(): TerminalAgentSession | null {
  return session;
}

export function destroySession(): void {
  if (session) {
    session.kill();
    session = null;
  }
}
