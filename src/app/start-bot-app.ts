import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { createBot } from "../bot/index.js";
import { config } from "../config.js";
import {
  createOpenCodeAutoRestartMonitor,
  type OpenCodeAutoRestartMonitor,
} from "../opencode/auto-restart.js";
import type { ProcessOperationResult } from "../process/types.js";
import { getLastRestartRequest, loadSettings, setLastRestartRequest, disposeDatabase } from "../settings/manager.js";
import { processManager } from "../process/manager.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { refreshSessionCacheIfOpencodeReady } from "../opencode/ready-refresh.js";
import { getRuntimeMode } from "../runtime/mode.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { stopBotContainers } from "../runtime/docker.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { logger } from "../utils/logger.js";
import { startHttpServer, stopHttpServer } from "../server/index.js";
import { t, type Locale } from "../i18n/index.js";

const STARTUP_LOCK_FILE_NAME = "bot-start.lock";

async function getBotVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL("../../package.json", import.meta.url);
    const packageJsonContent = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent) as { version?: string };

    return packageJson.version ?? "unknown";
  } catch (error) {
    logger.warn("[App] Failed to read bot version", error);
    return "unknown";
  }
}

async function acquireStartupLock(runtimePaths: { runDirPath: string }): Promise<() => Promise<void>> {
  const lockFilePath = path.join(runtimePaths.runDirPath, STARTUP_LOCK_FILE_NAME);
  await mkdir(runtimePaths.runDirPath, { recursive: true });

  try {
    const existingPidText = await readFile(lockFilePath, "utf-8");
    const existingPid = Number.parseInt(existingPidText.trim(), 10);

    if (Number.isNaN(existingPid)) {
      await unlink(lockFilePath).catch(() => {});
    } else {
      let processAlive = false;
      try {
        process.kill(existingPid, 0);
        processAlive = true;
      } catch (error) {
        const errno = error as NodeJS.ErrnoException;
        if (errno.code !== "ESRCH") {
          throw error;
        }

        await unlink(lockFilePath).catch(() => {});
      }

      if (processAlive) {
        throw new Error(
          `Another bot instance is already running (PID ${existingPid}). Stop it before starting a new one.`,
        );
      }
    }
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await writeFile(lockFilePath, `${process.pid}\n`, { flag: "wx" });
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "EEXIST") {
      throw new Error("Another bot instance is already starting. Try again in a moment.");
    }
    throw error;
  }

  return async () => {
    await unlink(lockFilePath).catch(() => {});
  };
}

export async function tryAutoStartServer(): Promise<boolean> {
  const runtimeResult = await processManager.ensureRuntime();
  if (runtimeResult.success) {
    return true;
  }

  logger.info("[App] OpenCode server is not running, attempting auto-start...");
  const startResult = await processManager.start();

  if (!startResult.success) {
    logger.warn(`[App] Failed to auto-start OpenCode server: ${startResult.error}`);
    return false;
  }

  logger.info("[App] OpenCode server auto-started successfully");
  return true;
}

interface StartBotAppDependencies {
  createMonitor?: (config: {
    enabled: boolean;
    intervalMs: number;
    isRuntimeAvailable: () => Promise<boolean>;
    start: () => Promise<ProcessOperationResult>;
  }) => OpenCodeAutoRestartMonitor;
}

async function isHostRuntimeAvailable(): Promise<boolean> {
  const runtimeInfo = processManager.getCurrentRuntimeInfo();
  return runtimeInfo.kind === "host" && runtimeInfo.managed;
}

export async function startBotApp(dependencies: StartBotAppDependencies = {}): Promise<void> {
  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();
  const version = await getBotVersion();
  const releaseStartupLock = await acquireStartupLock(runtimePaths);
  const createMonitor = dependencies.createMonitor ?? createOpenCodeAutoRestartMonitor;

  logger.info(`Starting OpenCode Telegram Bot v${version}...`);
  logger.info(`Config loaded from ${runtimePaths.envFilePath}`);
  logger.info(`Admin User ID: ${config.telegram.adminUserId}`);
  logger.debug(`[Runtime] Application start mode: ${mode}`);

  let bot: ReturnType<typeof createBot> | null = null;
  let autoRestartMonitor: OpenCodeAutoRestartMonitor | null = null;
  let shutdownRequested = false;

  const shutdownBotContainers = async (): Promise<void> => {
    try {
      await stopBotContainers();
    } catch (error) {
      logger.error("[App] Failed to stop bot containers:", error);
    }
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    logger.info(`[App] Received ${signal}, stopping bot...`);
    shutdownRequested = true;
    void bot?.stop();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await loadSettings();
    await processManager.initialize();
    await tryAutoStartServer();
    autoRestartMonitor = createMonitor({
      enabled: config.opencode.autoRestart.enabled,
      intervalMs: config.opencode.autoRestart.monitorIntervalSec * 1000,
      isRuntimeAvailable: isHostRuntimeAvailable,
      start: processManager.start.bind(processManager),
    });

    bot = createBot();
    await scheduledTaskRuntime.initialize(bot);

    autoRestartMonitor.start();
    safeBackgroundTask({
      taskName: "app.startupCacheRefresh",
      task: () => refreshSessionCacheIfOpencodeReady("startup"),
    });

    const webhookInfo = await bot.api.getWebhookInfo();
    if (webhookInfo.url) {
      logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
      await bot.api.deleteWebhook();
      logger.info("[Bot] Webhook removed, switching to long polling");
    }

    await startHttpServer();

    if (!shutdownRequested) {
      await bot.start({
        onStart: async (botInfo) => {
          logger.info(`Bot @${botInfo.username} started!`);

          const lastRestart = getLastRestartRequest();
          if (lastRestart?.chatId && lastRestart?.messageId) {
            try {
              await bot!.api.editMessageText(
                lastRestart.chatId,
                lastRestart.messageId,
                t("restart.completed", undefined, lastRestart.locale as Locale | undefined),
              );
            } catch (error) {
              logger.warn("[App] Failed to edit restart message:", error);
            }
            await setLastRestartRequest({ updateId: lastRestart.updateId, requestedAt: lastRestart.requestedAt });
          }
        },
      });
    }
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    autoRestartMonitor?.stop();
    processManager.dispose();
    await stopHttpServer();
    await shutdownBotContainers();
    await releaseStartupLock();
    disposeDatabase();
  }
}
