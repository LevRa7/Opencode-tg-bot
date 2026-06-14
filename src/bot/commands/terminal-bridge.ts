// VMPtyBridge — SSH pipe bridge to terminal agent on VM
//
// STUB — RED phase. Tests will fail.

import type { ChildProcess } from "child_process";

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

  constructor(bridgeIp: string) {
    throw new Error("Not implemented");
  }

  spawnSession(sessionId: string, opts?: { cols?: number; rows?: number; cwd?: string }): PtySessionHandle {
    throw new Error("Not implemented");
  }

  getSession(sessionId: string): PtySessionHandle | undefined {
    throw new Error("Not implemented");
  }

  killAll(): void {
    throw new Error("Not implemented");
  }

  get sessionCount(): number {
    throw new Error("Not implemented");
  }
}
