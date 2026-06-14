// STUB — RED phase. Tests will fail because these are empty.
// Replace with real implementation in GREEN phase.

export interface TerminalAgentSession {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TerminalAgent {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSession(id: string): TerminalAgentSession | undefined;
}

export function createServer(_opts?: { socketPath?: string }): Promise<TerminalAgent> {
  throw new Error("Not implemented");
}
