export interface BotServiceState {
  pid: number;
  startedAt: string;
  logFilePath: string;
  mode: "daemon";
}

export type ServiceCleanupReason = "stale" | "invalid" | null;

export interface BotServiceStatus {
  status: "running" | "stopped";
  service: BotServiceState | null;
  cleanupReason: ServiceCleanupReason;
  message?: string;
}

export interface ServiceOperationResult {
  success: boolean;
  service: BotServiceState | null;
  cleanupReason: ServiceCleanupReason;
  alreadyRunning?: boolean;
  alreadyStopped?: boolean;
  error?: string;
  message?: string;
}
