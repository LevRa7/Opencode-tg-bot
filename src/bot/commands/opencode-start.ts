import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { processManager } from "../../process/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { editBotText } from "../utils/telegram-text.js";

async function waitForServerReady(maxWaitMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { data, error } = await opencodeClient.global.health();

      if (!error && data?.healthy) {
        return true;
      }
    } catch {
      // Server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

export async function opencodeStartCommand(ctx: CommandContext<Context>) {
  try {
    const runtimeInfo = processManager.getCurrentRuntimeInfo();

    if (runtimeInfo.managed) {
      const uptime = runtimeInfo.uptimeMs ? Math.floor(runtimeInfo.uptimeMs / 1000) : 0;

      await ctx.reply(
        t("opencode_start.already_running_managed", {
          pid: runtimeInfo.pid ?? "-",
          seconds: uptime,
        }),
      );
      return;
    }

    try {
      const { data, error } = await opencodeClient.global.health();

      if (!error && data?.healthy) {
        await ctx.reply(
          t("opencode_start.already_running_external", {
            version: data.version || t("common.unknown"),
          }),
        );
        return;
      }
    } catch {
      // continue with managed start
    }

    const statusMessage = await ctx.reply(t("opencode_start.starting"));
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
          pid: processManager.getCurrentRuntimeInfo().pid ?? "-",
        }),
      });
      return;
    }

    const { data: health } = await opencodeClient.global.health();
    await editBotText({
      api: ctx.api,
      chatId: ctx.chat.id,
      messageId: statusMessage.message_id,
      text: t("opencode_start.success", {
        pid: processManager.getCurrentRuntimeInfo().pid ?? "-",
        version: health?.version || t("common.unknown"),
      }),
    });
  } catch (err) {
    logger.error("[Bot] Error in /opencode-start command:", err);
    await ctx.reply(t("opencode_start.error"));
  }
}
