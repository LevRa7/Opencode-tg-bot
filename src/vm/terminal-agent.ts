// Terminal Agent — runs on VM via SSH pipe
// Spawned as: node /opt/terminal-agent.js <sessionId> <cols> <rows> [cwd]
// Reads stdin (user input), writes stdout (PTY output).
//
// STUB — RED phase. Tests will fail.

import type { IPty } from "node-pty";

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
  throw new Error("Not implemented");
}

export function getSession(): TerminalAgentSession | null {
  throw new Error("Not implemented");
}

export function destroySession(): void {
  throw new Error("Not implemented");
}
