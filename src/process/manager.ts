import { exec, spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { config } from "../config.js";
import {
  clearServerProcess,
  clearTenantRuntimeInfo,
  getServerProcess,
  getTenantRuntimeInfo,
  getTenantRuntimes,
  setServerProcess,
  setTenantRuntimeInfo,
  type TenantRuntimeInfo,
} from "../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../telegram/scope.js";
import { logger } from "../utils/logger.js";
import { sshManager } from "../utils/ssh-manager.js";
import type {
  ProcessManagerInterface,
  ProcessOperationResult,
  ProcessRuntimeInfo,
  ProcessState,
} from "./types.js";

const execAsync = promisify(exec);
const TENANT_PORT_MIN = 49600;
const TENANT_PORT_MAX = 49999;
const HOST_HEALTH_TIMEOUT_MS = 10_000;
const HOST_HEALTH_POLL_MS = 500;
const TENANT_HEALTH_TIMEOUT_MS = 10_000;
const TENANT_HEALTH_POLL_MS = 500;
const TENANT_LAUNCH_SCRIPT_PATH = fileURLToPath(
  new URL("../../docker/run-opencode-serve.sh", import.meta.url),
);

class ProcessManager implements ProcessManagerInterface {
  private state: ProcessState = {
    process: null,
    pid: null,
    startTime: null,
    isRunning: false,
  };

  private tenantStartupLocks = new Map<number, Promise<ProcessOperationResult>>();

  async initialize(): Promise<void> {
    const savedProcess = getServerProcess();

    if (savedProcess) {
      logger.info(`[ProcessManager] Found saved host process: PID=${savedProcess.pid}`);

      if (this.isProcessAlive(savedProcess.pid)) {
        const healthy = await this.waitForHostHealth();
        if (healthy) {
          this.state = {
            process: null,
            pid: savedProcess.pid,
            startTime: new Date(savedProcess.startTime),
            isRunning: true,
          };
        } else {
          logger.warn(
            `[ProcessManager] Saved host process PID=${savedProcess.pid} is alive but not responding, cleaning up`,
          );
          clearServerProcess();
        }
      } else {
        logger.warn(`[ProcessManager] Saved host process PID=${savedProcess.pid} is dead, cleaning up`);
        clearServerProcess();
      }
    } else {
      logger.debug("[ProcessManager] No saved host process found in settings");
    }

    await this.cleanupDeadTenantRuntimes();

    // Start periodic tenant health watcher to detect and recover from dead tenants
    this.startTenantWatcher();

    // Recover saved SSH connections in the background
    void sshManager.recoverAll();
  }

  private tenantWatcherTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Periodically checks all tenant runtimes for liveness.
   * Dead tenants are cleaned up automatically.
   */
  private startTenantWatcher(intervalMs: number = 30_000): void {
    if (this.tenantWatcherTimer) {
      return;
    }

    this.tenantWatcherTimer = setInterval(async () => {
      await this.checkAndCleanupDeadTenants();
    }, intervalMs);

    // Don't block process exit on this timer
    this.tenantWatcherTimer.unref?.();

    logger.debug("[ProcessManager] Tenant health watcher started");
  }

  private async checkAndCleanupDeadTenants(): Promise<void> {
    const runtimes = getTenantRuntimes();
    for (const runtime of Object.values(runtimes)) {
      if (!runtime.pid) continue;

      if (!this.isProcessAlive(runtime.pid)) {
        logger.warn(
          `[ProcessManager] Tenant process dead: userId=${runtime.userId}, pid=${runtime.pid}`,
        );
        await clearTenantRuntimeInfo(runtime.userId);
        continue;
      }

      // Process alive but check HTTP health
      if (runtime.baseUrl && !await this.isTenantHttpHealthy(runtime.baseUrl)) {
        logger.warn(
          `[ProcessManager] Tenant HTTP unhealthy: userId=${runtime.userId}, pid=${runtime.pid}, baseUrl=${runtime.baseUrl}`,
        );
        await clearTenantRuntimeInfo(runtime.userId);
      }
    }
  }

  async ensureRuntime(): Promise<ProcessOperationResult> {
    if (this.isAdminScope()) {
      if (this.isRunning()) {
        return { success: true };
      }

      return this.start();
    }

    return this.ensureTenantRuntime();
  }

  async start(): Promise<ProcessOperationResult> {
    if (this.state.isRunning) {
      return {
        success: false,
        error: "Process already running",
      };
    }

    try {
      logger.info("[ProcessManager] Starting host OpenCode server process...");

      const isWindows = process.platform === "win32";
      const command = isWindows ? "cmd.exe" : "opencode";
      const args = isWindows ? ["/c", "opencode", "serve"] : ["serve"];

      const childProcess = spawn(command, args, {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: isWindows,
      });

      childProcess.on("error", (err) => {
        logger.error("[ProcessManager] Host process error:", err);
        this.cleanupHostRuntime();
      });

      if (!childProcess.pid) {
        throw new Error(
          "Failed to start OpenCode server process. Ensure 'opencode' is installed and available in PATH.",
        );
      }

      childProcess.on("exit", (code, signal) => {
        logger.info(`[ProcessManager] Host process exited: code=${code}, signal=${signal}`);
        this.cleanupHostRuntime();
      });

      if (childProcess.stdout) {
        childProcess.stdout.on("data", (data) => {
          logger.debug(`[OpenCode Server] ${data.toString().trim()}`);
        });
      }

      if (childProcess.stderr) {
        childProcess.stderr.on("data", (data) => {
          logger.warn(`[OpenCode Server Error] ${data.toString().trim()}`);
        });
      }

      const startTime = new Date();
      this.state = {
        process: childProcess,
        pid: childProcess.pid,
        startTime,
        isRunning: true,
      };

      const ready = await this.waitForHostHealth();
      if (!ready) {
        this.cleanupHostRuntime();
        return {
          success: false,
          error: `Host OpenCode server did not become ready at ${config.opencode.apiUrl}`,
        };
      }

      setServerProcess({
        pid: childProcess.pid,
        startTime: startTime.toISOString(),
      });

      logger.info(`[ProcessManager] Host OpenCode server started with PID=${childProcess.pid}`);
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("[ProcessManager] Failed to start host process:", err);
      this.cleanupHostRuntime();
      return { success: false, error: errorMessage };
    }
  }

  async stop(timeoutMs: number = 5000): Promise<ProcessOperationResult> {
    if (!this.isAdminScope()) {
      return await this.stopTenantRuntime(timeoutMs);
    }

    if (!this.state.isRunning || !this.state.pid) {
      return {
        success: false,
        error: "Process not running",
      };
    }

    try {
      const pid = this.state.pid;
      logger.info(`[ProcessManager] Stopping host process PID=${pid}...`);

      if (process.platform === "win32") {
        try {
          await execAsync(`taskkill /F /T /PID ${pid}`);
        } catch (err) {
          const error = err as Error;
          if (!error.message?.includes("not found")) {
            logger.warn(`[ProcessManager] taskkill error for PID=${pid}:`, err);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (this.state.process) {
        const childProcess = this.state.process;
        childProcess.kill("SIGINT");

        const gracefulExit = await this.waitForProcessExit(childProcess, timeoutMs);
        if (!gracefulExit && this.state.isRunning) {
          childProcess.kill("SIGKILL");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } else {
        try {
          process.kill(pid, "SIGTERM");
        } catch (err) {
          logger.debug(`[ProcessManager] Failed to send SIGTERM to PID=${pid}:`, err);
        }

        await new Promise((resolve) => setTimeout(resolve, timeoutMs));

        if (this.isProcessAlive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch (err) {
            logger.error(`[ProcessManager] Failed to send SIGKILL to PID=${pid}:`, err);
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      this.cleanupHostRuntime();
      logger.info(`[ProcessManager] Host process PID=${pid} stopped successfully`);
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("[ProcessManager] Failed to stop host process:", err);
      return { success: false, error: errorMessage };
    }
  }

  isRunning(): boolean {
    if (!this.isAdminScope()) {
      const scope = getCurrentTelegramConversationScope();
      const runtime = scope ? getTenantRuntimeInfo(scope.userId) : undefined;
      if (!runtime?.pid) {
        return false;
      }

      if (!this.isProcessAlive(runtime.pid)) {
        void clearTenantRuntimeInfo(runtime.userId);
        return false;
      }

      return true;
    }

    if (!this.state.isRunning || !this.state.pid) {
      return false;
    }

    if (!this.isProcessAlive(this.state.pid)) {
      logger.warn(`[ProcessManager] Host process PID=${this.state.pid} appears dead, cleaning up`);
      this.cleanupHostRuntime();
      return false;
    }

    return true;
  }

  getPID(): number | null {
    if (!this.isAdminScope()) {
      const scope = getCurrentTelegramConversationScope();
      return scope ? (getTenantRuntimeInfo(scope.userId)?.pid ?? null) : null;
    }

    return this.state.pid;
  }

  getUptime(): number | null {
    if (!this.isAdminScope()) {
      const scope = getCurrentTelegramConversationScope();
      const startTime = scope ? getTenantRuntimeInfo(scope.userId)?.startTime : undefined;
      return startTime ? Date.now() - Date.parse(startTime) : null;
    }

    if (!this.state.startTime || !this.state.isRunning) {
      return null;
    }
    return Date.now() - this.state.startTime.getTime();
  }

  getCurrentRuntimeInfo(): ProcessRuntimeInfo {
    const scope = getCurrentTelegramConversationScope();
    if (!scope || scope.userId === config.telegram.adminUserId) {
      return {
        kind: "host",
        baseUrl: config.opencode.apiUrl,
        managed: this.isRunning(),
        pid: this.getPID(),
        uptimeMs: this.getUptime(),
      };
    }

    const runtime = getTenantRuntimeInfo(scope.userId);
    return {
      kind: "tenant",
      userId: scope.userId,
      chatId: scope.chatId,
      tenantId: runtime?.tenantId,
      baseUrl: runtime?.baseUrl ?? this.buildTenantBaseUrl(TENANT_PORT_MIN),
      port: runtime?.port,
      managed: Boolean(runtime?.pid && this.isProcessAlive(runtime.pid)),
      pid: runtime?.pid ?? null,
      uptimeMs: runtime?.startTime ? Date.now() - Date.parse(runtime.startTime) : null,
    };
  }

  private isAdminScope(): boolean {
    const scope = getCurrentTelegramConversationScope();
    return !scope || scope.userId === config.telegram.adminUserId;
  }

  private async ensureTenantRuntime(): Promise<ProcessOperationResult> {
    const scope = getCurrentTelegramConversationScope();
    if (!scope) {
      return { success: false, error: "Telegram scope is not available for tenant runtime" };
    }

    const existingLock = this.tenantStartupLocks.get(scope.userId);
    if (existingLock) {
      return existingLock;
    }

    const startupPromise = this.doEnsureTenantRuntime(scope.userId).finally(() => {
      this.tenantStartupLocks.delete(scope.userId);
    });

    this.tenantStartupLocks.set(scope.userId, startupPromise);
    return startupPromise;
  }

  private async doEnsureTenantRuntime(userId: number): Promise<ProcessOperationResult> {
    const scope = getCurrentTelegramConversationScope();
    if (!scope) {
      return { success: false, error: "Telegram scope is not available for tenant runtime" };
    }

    const existingRuntime = getTenantRuntimeInfo(userId);
    if (existingRuntime?.pid && this.isProcessAlive(existingRuntime.pid)) {
      // Process is alive, but verify HTTP server is actually responding.
      // A zombie process can pass PID check while its HTTP server is dead.
      if (existingRuntime.baseUrl && await this.isTenantHttpHealthy(existingRuntime.baseUrl)) {
        return { success: true };
      }

      logger.warn(
        `[ProcessManager] Tenant process alive but HTTP unhealthy: userId=${userId}, pid=${existingRuntime.pid}`,
      );
      await clearTenantRuntimeInfo(userId);
    }

    if (existingRuntime?.pid && !this.isProcessAlive(existingRuntime.pid)) {
      await clearTenantRuntimeInfo(userId);
    }

    const tenantPort = existingRuntime?.port ?? (await this.findFreeTenantPort());
    const tenantId = existingRuntime?.tenantId ?? `tg-${userId}`;
    const baseUrl = this.buildTenantBaseUrl(tenantPort);
    const startResult = await this.startTenantRuntime({
      userId,
      chatId: scope.chatId,
      port: tenantPort,
      tenantId,
      baseUrl,
    });

    if (!startResult.success) {
      return startResult;
    }

    const ready = await this.waitForTenantHealth(baseUrl);
    if (!ready) {
      return { success: false, error: `Tenant runtime did not become ready at ${baseUrl}` };
    }

    return { success: true };
  }

  private async stopTenantRuntime(timeoutMs: number): Promise<ProcessOperationResult> {
    const scope = getCurrentTelegramConversationScope();
    if (!scope) {
      return { success: false, error: "Telegram scope is not available for tenant stop" };
    }

    const runtime = getTenantRuntimeInfo(scope.userId);
    if (!runtime?.pid) {
      return { success: false, error: "Process not running" };
    }

    return await this.stopTenantRuntimeByInfo(runtime, timeoutMs);
  }

  async restartTenantRuntimes(): Promise<ProcessOperationResult> {
    const runtimes = Object.values(getTenantRuntimes()).sort((left, right) => left.userId - right.userId);
    if (runtimes.length === 0) {
      return { success: true };
    }

    for (const runtime of runtimes) {
      if (runtime.pid && this.isProcessAlive(runtime.pid)) {
        const stopResult = await this.stopTenantRuntimeByInfo(runtime, 10_000);
        if (!stopResult.success) {
          return stopResult;
        }
      } else if (runtime.pid) {
        await clearTenantRuntimeInfo(runtime.userId);
      }

      const startResult = await this.startTenantRuntime(runtime);
      if (!startResult.success) {
        return startResult;
      }

      const ready = await this.waitForTenantHealth(runtime.baseUrl);
      if (!ready) {
        const runningRuntime = getTenantRuntimeInfo(runtime.userId);
        if (runningRuntime?.pid) {
          await this.stopTenantRuntimeByInfo(runningRuntime, 10_000);
        } else {
          await clearTenantRuntimeInfo(runtime.userId);
        }

        return { success: false, error: `Tenant runtime did not become ready at ${runtime.baseUrl}` };
      }
    }

    return { success: true };
  }

  private async stopTenantRuntimeByInfo(
    runtime: TenantRuntimeInfo,
    timeoutMs: number,
  ): Promise<ProcessOperationResult> {
    try {
      logger.info(
        `[ProcessManager] Stopping tenant runtime: userId=${runtime.userId}, pid=${runtime.pid}`,
      );

      const runtimePid = runtime.pid;
      if (runtimePid == null) {
        await clearTenantRuntimeInfo(runtime.userId);
        return { success: true };
      }

      try {
        process.kill(runtimePid, "SIGTERM");
      } catch (err) {
        logger.debug(`[ProcessManager] Failed to send SIGTERM to tenant PID=${runtimePid}:`, err);
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (!this.isProcessAlive(runtimePid)) {
          await clearTenantRuntimeInfo(runtime.userId);
          return { success: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      try {
        process.kill(runtimePid, "SIGKILL");
      } catch (err) {
        logger.debug(`[ProcessManager] Failed to send SIGKILL to tenant PID=${runtimePid}:`, err);
      }

      await clearTenantRuntimeInfo(runtime.userId);
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("[ProcessManager] Failed to stop tenant runtime:", err);
      return { success: false, error: errorMessage };
    }
  }

  private async startTenantRuntime(runtime: TenantRuntimeInfo): Promise<ProcessOperationResult> {
    try {
      logger.info(
        `[ProcessManager] Starting tenant runtime: userId=${runtime.userId}, port=${runtime.port}, tenantId=${runtime.tenantId}`,
      );

      const childProcess = spawn("bash", [TENANT_LAUNCH_SCRIPT_PATH], {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: process.platform === "win32",
        env: {
          ...process.env,
          HOST_PORT: String(runtime.port),
          TG_ID: String(runtime.userId),
          TG_CHAT_ID: String(runtime.chatId),
          TG_TENANT_ID: runtime.tenantId,
        },
      });

      if (!childProcess.pid) {
        throw new Error(`Failed to start tenant runtime for userId=${runtime.userId}`);
      }

      childProcess.on("error", (err) => {
        logger.error(`[ProcessManager] Tenant process error for userId=${runtime.userId}:`, err);
      });

      childProcess.on("exit", async (code, signal) => {
        logger.info(
          `[ProcessManager] Tenant process exited: userId=${runtime.userId}, code=${code}, signal=${signal}`,
        );
        const savedRuntime = getTenantRuntimeInfo(runtime.userId);
        if (savedRuntime?.pid === childProcess.pid) {
          await clearTenantRuntimeInfo(runtime.userId);
        }
      });

      if (childProcess.stdout) {
        childProcess.stdout.on("data", (data) => {
          logger.debug(`[Tenant ${runtime.userId}] ${data.toString().trim()}`);
        });
      }

      if (childProcess.stderr) {
        childProcess.stderr.on("data", (data) => {
          logger.warn(`[Tenant ${runtime.userId} Error] ${data.toString().trim()}`);
        });
      }

      await setTenantRuntimeInfo(runtime.userId, {
        ...runtime,
        pid: childProcess.pid,
        startTime: new Date().toISOString(),
      });

      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("[ProcessManager] Failed to start tenant runtime:", err);
      await clearTenantRuntimeInfo(runtime.userId);
      return { success: false, error: errorMessage };
    }
  }

  private async waitForHostHealth(): Promise<boolean> {
    return this.waitForHealth(config.opencode.apiUrl, HOST_HEALTH_TIMEOUT_MS, HOST_HEALTH_POLL_MS);
  }

  private async waitForTenantHealth(baseUrl: string): Promise<boolean> {
    return this.waitForHealth(baseUrl, TENANT_HEALTH_TIMEOUT_MS, TENANT_HEALTH_POLL_MS);
  }

  /**
   * Quick HTTP health check for a tenant.
   * Returns true if the tenant responds to /global/health within a short timeout.
   */
  private async isTenantHttpHealthy(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/global/health`, {
        headers: this.getOpencodeAuthHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForHealth(
    baseUrl: string,
    timeoutMs: number,
    pollMs: number,
  ): Promise<boolean> {
    const startedAt = Date.now();
    logger.debug(`[ProcessManager] waitForHealth started for ${baseUrl}`);

    let attempt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      attempt++;
      try {
        logger.debug(`[ProcessManager] waitForHealth attempt ${attempt} for ${baseUrl}`);
        const response = await fetch(`${baseUrl}/global/health`, {
          headers: this.getOpencodeAuthHeaders(),
          signal: AbortSignal.timeout(2000),
        });

        logger.debug(`[ProcessManager] waitForHealth response status: ${response.status}`);
        if (response.ok) {
          return true;
        }
      } catch (err) {
        logger.debug(`[ProcessManager] waitForHealth attempt ${attempt} failed:`, err);
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    logger.debug(`[ProcessManager] waitForHealth timeout reached for ${baseUrl}`);
    return false;
  }

  private getOpencodeAuthHeaders(): Record<string, string> | undefined {
    if (!config.opencode.password) {
      return undefined;
    }

    const credentials = `${config.opencode.username}:${config.opencode.password}`;
    return {
      Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
    };
  }

  private async cleanupDeadTenantRuntimes(): Promise<void> {
    const runtimes = getTenantRuntimes();
    await Promise.all(
      Object.values(runtimes).map(async (runtime) => {
        if (!runtime.pid || this.isProcessAlive(runtime.pid)) {
          return;
        }

        logger.warn(
          `[ProcessManager] Saved tenant runtime is dead, cleaning up: userId=${runtime.userId}, pid=${runtime.pid}`,
        );
        await clearTenantRuntimeInfo(runtime.userId);
      }),
    );
  }

  private async findFreeTenantPort(): Promise<number> {
    for (let port = TENANT_PORT_MIN; port <= TENANT_PORT_MAX; port += 1) {
      if (await this.isPortFree(port)) {
        return port;
      }
    }

    throw new Error(`No free tenant ports available in range ${TENANT_PORT_MIN}-${TENANT_PORT_MAX}`);
  }

  private async isPortFree(port: number): Promise<boolean> {
    try {
      await fetch(this.buildTenantBaseUrl(port) + "/health");
      return false;
    } catch {
      return true;
    }
  }

  private buildTenantBaseUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async waitForProcessExit(
    childProcess: ChildProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const exitHandler = () => {
        resolve(true);
      };

      childProcess.once("exit", exitHandler);

      setTimeout(() => {
        childProcess.removeListener("exit", exitHandler);
        resolve(false);
      }, timeoutMs);
    });
  }

  private cleanupHostRuntime(): void {
    this.state = {
      process: null,
      pid: null,
      startTime: null,
      isRunning: false,
    };
    clearServerProcess();
  }

  /**
   * Stop the periodic tenant health watcher.
   * Call this during graceful shutdown.
   */
  dispose(): void {
    if (this.tenantWatcherTimer) {
      clearInterval(this.tenantWatcherTimer);
      this.tenantWatcherTimer = null;
      logger.debug("[ProcessManager] Tenant health watcher stopped");
    }
  }
}

export const processManager = new ProcessManager();
