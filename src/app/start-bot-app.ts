import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { createBot } from "../bot/index.js";
import { config } from "../config.js";
import { loadSettings } from "../settings/manager.js";
import { processManager } from "../process/manager.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { warmupHostSessionDirectoryCache } from "../session/cache-manager.js";
import { reconcileStoredModelSelection } from "../model/manager.js";
import { getRuntimeMode } from "../runtime/mode.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { logger } from "../utils/logger.js";

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

export async function startBotApp(): Promise<void> {
  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();
  const version = await getBotVersion();
  const releaseStartupLock = await acquireStartupLock(runtimePaths);

  logger.info(`Starting OpenCode Telegram Bot v${version}...`);
  logger.info(`Config loaded from ${runtimePaths.envFilePath}`);
  logger.info(`Admin User ID: ${config.telegram.adminUserId}`);
  logger.debug(`[Runtime] Application start mode: ${mode}`);

  try {
    await loadSettings();
    await processManager.initialize();
    await processManager.ensureRuntime();
    await reconcileStoredModelSelection();
    await warmupHostSessionDirectoryCache();

    const bot = createBot();
    await scheduledTaskRuntime.initialize(bot);

    const webhookInfo = await bot.api.getWebhookInfo();
    if (webhookInfo.url) {
      logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
      await bot.api.deleteWebhook();
      logger.info("[Bot] Webhook removed, switching to long polling");
    }

    await bot.start({
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} started!`);
      },
    });
  } finally {
    await releaseStartupLock();
  }
}
