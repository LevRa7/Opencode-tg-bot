import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { webhookCallback } from "grammy";

import { createBot, disposeBotIntervals } from "../bot/index.js";
import { config } from "../config.js";
import {
  ensureTelegramWebhook,
  isTelegramWebhookDeliveryUnhealthy,
  switchTelegramToPolling,
  TELEGRAM_ALLOWED_UPDATES,
} from "../bot/update-config.js";
import {
  createOpenCodeAutoRestartMonitor,
  type OpenCodeAutoRestartMonitor,
} from "../opencode/auto-restart.js";
import type { ProcessOperationResult } from "../process/types.js";
import { getLastRestartRequest, loadSettings, setLastRestartRequest, disposeDatabase } from "../settings/manager.js";
import { processManager } from "../process/manager.js";
import { configureAlarm } from "../vm/alarm.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { refreshSessionCacheIfOpencodeReady } from "../opencode/ready-refresh.js";
import { getRuntimeMode } from "../runtime/mode.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { stopBotContainers } from "../runtime/docker.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { logger } from "../utils/logger.js";
import { setTelegramWebhookRequestHandler, startHttpServer, stopHttpServer } from "../server/index.js";
import { t, type Locale } from "../i18n/index.js";

const STARTUP_LOCK_FILE_NAME = "bot-start.lock";
const WEBHOOK_HEALTH_CHECK_DELAY_MS = 30_000;

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

async function startBotPollingWithRetries(bot: ReturnType<typeof createBot>): Promise<void> {
  let startAttempt = 0;
  const maxStartRetries = 10;

  while (true) {
    try {
      await bot.start({
        allowed_updates: [
          ...TELEGRAM_ALLOWED_UPDATES,
        ],
        onStart: async (botInfo) => {
          logger.info(`Bot @${botInfo.username} started!`);

          const lastRestart = getLastRestartRequest();
          if (lastRestart?.chatId && lastRestart?.messageId) {
            try {
              await bot.api.editMessageText(
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
      return;
    } catch (error) {
      const msg = (error as Error)?.message ?? String(error);
      if (msg.includes("409") || msg.includes("terminated by other getUpdates")) {
        startAttempt++;
        if (startAttempt >= maxStartRetries) {
          throw error;
        }
        logger.warn(`[App] getUpdates 409 conflict, retrying in 5s (${startAttempt}/${maxStartRetries})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw error;
      }
    }
  }
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
  // Configure VM alarm system — sends Telegram notifications instead of destroying VMs
  configureAlarm({
    botToken: config.telegram.token,
    adminUserId: config.telegram.adminUserId,
    enabled: true,
  });
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

    if (!shutdownRequested) {
      if (config.telegram.updateMode === "webhook") {
        const activeBot = bot;
        if (!config.telegram.webhookBaseUrl) {
          throw new Error("TELEGRAM_WEBHOOK_BASE_URL is required when TELEGRAM_UPDATE_MODE=webhook");
        }
        if (!config.telegram.webhookSecret) {
          throw new Error("TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_UPDATE_MODE=webhook");
        }

        const handleUpdate = webhookCallback(bot, "http", {
          secretToken: config.telegram.webhookSecret,
        });
        setTelegramWebhookRequestHandler(config.telegram.webhookPath, handleUpdate);

        try {
          await startHttpServer();
        } catch (err) {
          logger.warn("[App] HTTP server failed to start for webhook mode, falling back to polling:", err);
          await switchTelegramToPolling(activeBot.api);
          await startBotPollingWithRetries(activeBot);
          return;
        }

        const webhookUrl = await ensureTelegramWebhook(activeBot.api, {
          baseUrl: config.telegram.webhookBaseUrl,
          path: config.telegram.webhookPath,
          secret: config.telegram.webhookSecret,
        });
        logger.info(`[Bot] Webhook mode enabled: ${webhookUrl}`);

        await new Promise<void>((resolve) => {
          let fallbackStarted = false;
          const webhookStartedAt = Math.floor(Date.now() / 1000);
          const fallbackTimer = setInterval(() => {
            safeBackgroundTask({
              taskName: "app.webhookFallbackHealthCheck",
              task: async () => {
                if (fallbackStarted) {
                  return;
                }

                const webhookInfo = await activeBot.api.getWebhookInfo();
                if (!isTelegramWebhookDeliveryUnhealthy(webhookInfo, webhookStartedAt)) {
                  return;
                }

                fallbackStarted = true;
                clearInterval(fallbackTimer);
                logger.warn(
                  `[Bot] Webhook delivery unhealthy after startup; switching to getUpdates fallback. ` +
                    `pending=${webhookInfo.pending_update_count}, lastError=${webhookInfo.last_error_message ?? "unknown"}`,
                );
                await switchTelegramToPolling(activeBot.api);
                await startBotPollingWithRetries(activeBot);
                resolve();
              },
            });
          }, WEBHOOK_HEALTH_CHECK_DELAY_MS);

          activeBot.init().then(() => {
            logger.info(`Bot @${activeBot.botInfo.username} started in webhook mode!`);
          }).catch((error) => {
            logger.warn("[Bot] Failed to prefetch bot info in webhook mode", error);
          });

          const resolveOnShutdown = (): void => {
            clearInterval(fallbackTimer);
            if (!fallbackStarted) {
              resolve();
            }
          };
          process.once("SIGINT", resolveOnShutdown);
          process.once("SIGTERM", resolveOnShutdown);
        });
        return;
      }

      try {
        await startHttpServer();
      } catch (err) {
        logger.warn("[App] HTTP server failed to start, continuing without it:", err);
      }

      await switchTelegramToPolling(bot.api);
      logger.info("[Bot] Polling mode enabled");

      // Retry on 409 Conflict (stale long-polling connection from previous instance)
      await startBotPollingWithRetries(bot);
    }
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    autoRestartMonitor?.stop();
    await stopHttpServer();
    // Kill the host OpenCode server process BEFORE closing the database.
    // Otherwise, systemd's SIGTERM to the process group causes the child
    // process to exit AFTER the DB is closed, and the 'exit' handler's
    // cleanupHostRuntime() -> clearServerProcess() crashes with:
    //   TypeError: The database connection is not open
    try {
      await processManager.stop();
    } catch (err) {
      logger.warn("[App] Failed to stop host process during shutdown:", err);
    }
    processManager.dispose();
    disposeBotIntervals();
    await shutdownBotContainers();
    await releaseStartupLock();
    disposeDatabase();
    // Force process exit after all cleanup is done.
    // Multiple async sources (Docker execFile, qemu-img, SSH, deferred batch timers,
    // health proxy polling) can leave lingering handles that keep the event loop alive.
    // All meaningful cleanup is finished — exit immediately.
    process.exit(0);
  }
}
