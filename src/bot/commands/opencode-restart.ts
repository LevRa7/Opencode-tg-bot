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
import { abortThenRun } from "../utils/abort-then-run.js";

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
          resolve(HEALTH_CHECK_TIMED_OUT);
        }, timeoutMs);
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

export async function opencodeRestartCommand(ctx: CommandContext<Context>) {
  const messageThreadId = extractMessageThreadIdFromContext(ctx);

  await abortThenRun(ctx, async () => {
    try {
      const userId = ctx.from?.id;

      if (userId && sshManager.isSshActive(userId)) {
        const statusMsg = await ctx.reply(
          "⏳ " + t("opencode_restart.restarting"),
          withMessageThreadId(undefined, messageThreadId),
        );

        await sshManager.disconnect(userId);
        logger.info("[Bot] SSH disconnected for restart by user", userId);

        const savedConns = await sshManager.getSavedConnections(userId);
        if (savedConns.length > 0) {
          const conn = savedConns[0];
          try {
            await sshManager.connect(userId, conn.details, conn.auth, conn.deployTarget);
            await sshManager.bootstrapRemoteServer(userId);
            logger.info("[Bot] SSH reconnected after restart for user", userId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await ctx.api.editMessageText(
              ctx.chat!.id,
              statusMsg.message_id,
              "❌ " + msg + "\n\n" + t("opencode_restart.ssh_reconnect_error"),
            );
            return;
          }
        }

        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          t("opencode_restart.success_ssh"),
        );
        return;
      }

      const localTarget = resolveLocalOpencodeTarget(config.opencode.apiUrl);
      if (!localTarget) {
        await ctx.reply(
          t("opencode_restart.remote_configured"),
          withMessageThreadId(undefined, messageThreadId),
        );
        return;
      }

      const statusMsg = await ctx.reply(
        t("opencode_restart.restarting"),
        withMessageThreadId(undefined, messageThreadId),
      );

      if (processManager.isRunning()) {
        const { success: stopOk, error: stopErr } = await processManager.stop(5000);
        if (!stopOk) {
          await editBotText({
            api: ctx.api,
            chatId: ctx.chat.id,
            messageId: statusMsg.message_id,
            text: t("opencode_restart.stop_error", { error: stopErr || t("common.unknown_error") }),
          });
          return;
        }
      }

      const { success: startOk, error: startErr } = await processManager.ensureRuntime();
      if (!startOk) {
        await editBotText({
          api: ctx.api,
          chatId: ctx.chat.id,
          messageId: statusMsg.message_id,
          text: t("opencode_restart.start_error", { error: startErr || t("common.unknown_error") }),
        });
        return;
      }

      logger.info("[Bot] Waiting for OpenCode runtime to become ready...");
      const ready = await waitForServerReady(SERVER_READY_TIMEOUT_MS);

      if (!ready) {
        await editBotText({
          api: ctx.api,
          chatId: ctx.chat.id,
          messageId: statusMsg.message_id,
          text: t("opencode_restart.not_ready", {
            pid: processManager.getCurrentRuntimeInfo().pid ?? "-",
          }),
        });
        return;
      }

      const health = (await getHealthIfAvailable())?.data;
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMsg.message_id,
        text: t("opencode_restart.success", {
          pid: processManager.getCurrentRuntimeInfo().pid ?? "-",
          version: health?.version || t("common.unknown"),
        }),
      });
      await refreshSessionCacheAfterOpencodeReady("opencode_restart_success");
    } catch (err) {
      logger.error("[Bot] Error in /opencode-restart command:", err);
      await ctx.reply(
        t("opencode_restart.error"),
        withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
      );
    }
  });
}
