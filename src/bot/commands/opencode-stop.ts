import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { processManager } from "../../process/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export async function opencodeStopCommand(ctx: CommandContext<Context>) {
  try {
    if (!processManager.isRunning()) {
      try {
        const { data, error } = await opencodeClient.global.health();

        if (!error && data?.healthy) {
          await ctx.reply(t("opencode_stop.external_running"));
          return;
        }
      } catch {
        // Server not accessible
      }

      await ctx.reply(t("opencode_stop.not_running"));
      return;
    }

    const pid = processManager.getPID();
    const statusMessage = await ctx.reply(t("opencode_stop.stopping", { pid: pid ?? "-" }));
    const { success, error } = await processManager.stop(5000);

    if (!success) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        t("opencode_stop.stop_error", { error: error || t("common.unknown_error") }),
      );
      return;
    }

    await ctx.api.editMessageText(ctx.chat.id, statusMessage.message_id, t("opencode_stop.success"));
    logger.info("[Bot] OpenCode host server stopped successfully");
  } catch (err) {
    logger.error("[Bot] Error in /opencode-stop command:", err);
    await ctx.reply(t("opencode_stop.error"));
  }
}
