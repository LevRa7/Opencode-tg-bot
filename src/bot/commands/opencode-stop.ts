import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import {
  resolveLocalOpencodeTarget,
  findServerPid,
  killServerProcess,
} from "../../opencode/process.js";
import { processManager } from "../../process/manager.js";
import { sshManager } from "../../utils/ssh-manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { editBotText } from "../utils/telegram-text.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { abortThenRun } from "../utils/abort-then-run.js";

export async function opencodeStopCommand(ctx: CommandContext<Context>) {
  const messageThreadId = extractMessageThreadIdFromContext(ctx);

  await abortThenRun(ctx, async () => {
    try {
      // If SSH is active, disconnect SSH (which stops the remote OpenCode server)
      const userId = ctx.from?.id;
      if (userId && sshManager.isSshActive(userId)) {
        const statusMsg = await ctx.reply(
          "⏳ " + t("opencode_stop.stopping", { pid: "SSH" }),
          withMessageThreadId(undefined, messageThreadId),
        );
        await sshManager.disconnect(userId);
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          t("opencode_stop.success"),
        );
        logger.info("[Bot] SSH disconnected and remote OpenCode server stopped for user", userId);
        return;
      }

      const localTarget = resolveLocalOpencodeTarget(config.opencode.apiUrl);
      if (!localTarget) {
        await ctx.reply(
          t("opencode_stop.remote_configured"),
          withMessageThreadId(undefined, messageThreadId),
        );
        return;
      }

      // If the server is managed by our process manager, stop it via manager
      if (processManager.isRunning()) {
        const pid = processManager.getPID();
        const statusMessage = await ctx.reply(
          t("opencode_stop.stopping", { pid: pid ?? "-" }),
          withMessageThreadId(undefined, messageThreadId),
        );
        const { success, error } = await processManager.stop(5000);

        if (!success) {
          await editBotText({
            api: ctx.api,
            chatId: ctx.chat.id,
            messageId: statusMessage.message_id,
            text: t("opencode_stop.stop_error", { error: error || t("common.unknown_error") }),
          });
          return;
        }

        await editBotText({
          api: ctx.api,
          chatId: ctx.chat.id,
          messageId: statusMessage.message_id,
          text: t("opencode_stop.success"),
        });
        logger.info("[Bot] OpenCode host server stopped successfully (via process manager)");
        return;
      }

      // Server is not managed by us, try to detect and stop external process
      let healthError: string | null = null;
      let isHealthy = false;
      try {
        const { data, error } = await opencodeClient.global.health();
        healthError = error ? String(error) : null;
        isHealthy = !error && data?.healthy === true;
      } catch (err) {
        healthError = String(err);
      }
      if (healthError || !isHealthy) {
        await ctx.reply(
          t("opencode_stop.not_running"),
          withMessageThreadId(undefined, messageThreadId),
        );
        return;
      }

      // Server is healthy but not managed by us
      const pid = await findServerPid(localTarget.port);
      if (pid === null) {
        await ctx.reply(
          t("opencode_stop.pid_not_found", { port: localTarget.port }),
          withMessageThreadId(undefined, messageThreadId),
        );
        return;
      }

      const statusMessage = await ctx.reply(
        t("opencode_stop.stopping", { pid }),
        withMessageThreadId(undefined, messageThreadId),
      );
      const killed = await killServerProcess(pid, 5000);

      if (!killed) {
        await editBotText({
          api: ctx.api,
          chatId: ctx.chat.id,
          messageId: statusMessage.message_id,
          text: t("opencode_stop.stop_error", { error: t("common.unknown_error") }),
        });
        return;
      }

      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_stop.success"),
      });
      logger.info("[Bot] OpenCode external server stopped successfully");
    } catch (err) {
      logger.error("[Bot] Error in /opencode-stop command:", err);
      await ctx.reply(t("opencode_stop.error"), withMessageThreadId(undefined, messageThreadId));
    }
  });
}
