import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { resolveLocalOpencodeTarget } from "../../opencode/process.js";
import { refreshSessionCacheAfterOpencodeReady } from "../../opencode/ready-refresh.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { processManager } from "../../process/manager.js";
import { sshManager } from "../../utils/ssh-manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { editBotText } from "../utils/telegram-text.js";

const SERVER_READY_TIMEOUT_MS = 10_000;
const SERVER_READY_POLL_INTERVAL_MS = 500;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;
const HEALTH_CHECK_TIMED_OUT = Symbol("health-check-timed-out");

type HealthCheckResult = Awaited<ReturnType<typeof opencodeClient.global.health>>;

async function healthWithTimeout(
  timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS,
): Promise<HealthCheckResult | typeof HEALTH_CHECK_TIMED_OUT> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      opencodeClient.global.health({ signal: controller.signal }),
      new Promise<typeof HEALTH_CHECK_TIMED_OUT>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(HEALTH_CHECK_TIMED_OUT);        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function getHealthIfAvailable(): Promise<HealthCheckResult | null> {
  try {
    const result = await healthWithTimeout();
    if (result === HEALTH_CHECK_TIMED_OUT) {
      logger.warn(`[Bot] OpenCode health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`);
      return null;
    }

    return result;
  } catch {
    return null;
  }
}

async function waitForServerReady(maxWaitMs: number = SERVER_READY_TIMEOUT_MS): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const health = await getHealthIfAvailable();
    if (health?.data?.healthy) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, SERVER_READY_POLL_INTERVAL_MS));
  }

  return false;
}

export async function opencodeStartCommand(ctx: CommandContext<Context>) {
  const messageThreadId = extractMessageThreadIdFromContext(ctx);

  try {
    // If SSH was used before and is now disconnected, reconnect it
    const userId = ctx.from?.id;
    if (userId && !sshManager.isSshActive(userId)) {
      const savedConns = await sshManager.getSavedConnections(userId);
      if (savedConns.length > 0) {
        const conn = savedConns[0];
        const statusMsg = await ctx.reply("⏳ " + t("ssh.connecting_saved"), withMessageThreadId(undefined, messageThreadId));
        try {
          await sshManager.connect(userId, conn.details, conn.auth, conn.deployTarget);
          await sshManager.bootstrapRemoteServer(userId);
          await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, t("ssh.success"));
          logger.info("[Bot] SSH reconnected and remote OpenCode server started for user", userId);        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await ctx.reply("❌ " + msg + "\n\nИспользуйте /ssh для подключения.");
        }
        return;
      }
    }
    // If SSH is already active, nothing to do
    if (userId && sshManager.isSshActive(userId)) {
      const conn = sshManager.getActiveConnection(userId);
      const details = conn?.details;
      if (details) {
        await ctx.reply(
          t("ssh.active_status", {
            username: details.username,
            host: details.host,
            port: String(details.port ?? 22),
          }) + "\n\nДля перезапуска используйте /ssh → Disconnect, затем /opencode_start.",
          withMessageThreadId(undefined, messageThreadId),
        );
      }
      return;
    }

    const localTarget = resolveLocalOpencodeTarget(config.opencode.apiUrl);
    if (!localTarget) {
      await ctx.reply(
        t("opencode_start.remote_configured"),
        withMessageThreadId(undefined, messageThreadId),
      );
      return;
    }

    const runtimeInfo = processManager.getCurrentRuntimeInfo();

    if (runtimeInfo.managed) {
      const uptime = runtimeInfo.uptimeMs ? Math.floor(runtimeInfo.uptimeMs / 1000) : 0;

      await ctx.reply(
        t("opencode_start.already_running_managed", {
          pid: runtimeInfo.pid ?? "-",
          seconds: uptime,        }),
        withMessageThreadId(undefined, messageThreadId),
      );
      await refreshSessionCacheAfterOpencodeReady("opencode_start_already_running");
      return;
    }

    const existingHealth = await getHealthIfAvailable();
    if (existingHealth?.data?.healthy) {
      await ctx.reply(
        t("opencode_start.already_running_external", {
          version: existingHealth.data.version || t("common.unknown"),        }),
        withMessageThreadId(undefined, messageThreadId),
      );
      return;
    }

    const statusMessage = await ctx.reply(
      t("opencode_start.starting"),
      withMessageThreadId(undefined, messageThreadId),
    );
    const { success, error } = await processManager.ensureRuntime();

    if (!success) {
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_start.start_error", { error: error || t("common.unknown_error") }),
      });
      return;
    }

    logger.info("[Bot] Waiting for OpenCode runtime to become ready...");
    const ready = await waitForServerReady(10000);

    if (!ready) {
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_start.started_not_ready", {
          pid: processManager.getCurrentRuntimeInfo().pid ?? "-",        }),
      });
      return;
    }

    const health = (await getHealthIfAvailable())?.data;
    await editBotText({
      api: ctx.api,
      chatId: ctx.chat.id,
      messageId: statusMessage.message_id,
      text: t("opencode_start.success", {
        pid: processManager.getCurrentRuntimeInfo().pid ?? "-",
        version: health?.version || t("common.unknown"),
      }),
    });
    await refreshSessionCacheAfterOpencodeReady("opencode_start_success");
  } catch (err) {
    logger.error("[Bot] Error in /opencode-start command:", err);
    await ctx.reply(
      t("opencode_start.error"),
      withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
    );
  }
}
