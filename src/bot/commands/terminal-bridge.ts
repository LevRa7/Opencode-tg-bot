// STUB — RED phase. Tests will fail because these are empty.
// Replace with real implementation in GREEN phase.

export interface PtySessionHandle {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface BridgeCallbacks {
  onData: (sessionId: string, data: string) => void;
  onExit: (sessionId: string, code: number | null) => void;
}

export class VMPtyBridge {
  constructor(_bridgeIp: string, _callbacks: BridgeCallbacks) {
    throw new Error("Not implemented");
  }
  start(): Promise<void> {
    throw new Error("Not implemented");
  }
  stop(): Promise<void> {
    throw new Error("Not implemented");
  }
  spawnSession(_cmd: string, _cwd?: string, _cols?: number, _rows?: number): Promise<PtySessionHandle> {
    throw new Error("Not implemented");
  }
  getSession(_id: string): PtySessionHandle | undefined {
    throw new Error("Not implemented");
  }
  requestScreenshot(_sessionId: string): Promise<string> {
    throw new Error("Not implemented");
  }
}
