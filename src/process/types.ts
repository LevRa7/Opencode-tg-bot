import type { ChildProcess } from "child_process";

export interface ProcessState {
  process: ChildProcess | null;
  pid: number | null;
  startTime: Date | null;
  isRunning: boolean;
}

export interface ProcessOperationResult {
  success: boolean;
  error?: string;
  needsVmSpec?: boolean;
}

export interface ProcessRuntimeInfo {
  kind: "host" | "tenant" | "vm";
  userId?: number;
  chatId?: number;
  tenantId?: string;
  baseUrl: string;
  port?: number;
  managed: boolean;
  pid: number | null;
  uptimeMs: number | null;
}

export interface ProcessManagerInterface {
  initialize(): Promise<void>;
  ensureRuntime(onProgress?: (step: string) => void): Promise<ProcessOperationResult>;
  ensureRuntimeForUser(userId: number): Promise<ProcessOperationResult>;
  start(): Promise<ProcessOperationResult>;
  stop(timeoutMs?: number): Promise<ProcessOperationResult>;
  restartTenantRuntimes(): Promise<ProcessOperationResult>;
  isRunning(): boolean;
  getPID(): number | null;
  getUptime(): number | null;
  getCurrentRuntimeInfo(): ProcessRuntimeInfo;
}
