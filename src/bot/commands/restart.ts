import { CommandContext, Context } from "grammy";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { getLocale, t } from "../../i18n/index.js";
import { restartCurrentProcess } from "../../runtime/restart.js";
import { stopBotContainers } from "../../runtime/docker.js";
import { getLastRestartRequest, setLastRestartRequest } from "../../settings/manager.js";
import { processManager } from "../../process/manager.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";
import { abortThenRun } from "../utils/abort-then-run.js";

let restartInProgress = false;
const RESTART_TRIGGER_DELAY_MS = 1500;

export function __resetRestartStateForTests(): void {
  restartInProgress = false;
}

export async function restartCommand(ctx: CommandContext<Context>): Promise<void> {
  const messageThreadId = extractMessageThreadIdFromContext(ctx);

  if (ctx.from?.id !== config.telegram.adminUserId) {
    await ctx.reply(t("restart.admin_only"), withMessageThreadId(undefined, messageThreadId));
    return;
  }

  const updateId = ctx.update.update_id;
  const lastRestartRequest = getLastRestartRequest();

  if (lastRestartRequest?.updateId === updateId) {
    logger.warn(`[Bot] Ignoring duplicate /restart update_id=${updateId}`);
    return;
  }

  if (restartInProgress) {
    await ctx.reply(t("restart.in_progress"), withMessageThreadId(undefined, messageThreadId));
    return;
  }

  await abortThenRun(ctx, async () => {
    try {
      restartInProgress = true;
      logger.info(`[Bot] Restart requested by user=${ctx.from?.id ?? "unknown"}`);

      const sentMessage = await ctx.reply(t("restart.restarting"), withMessageThreadId(undefined, messageThreadId));

      const timer = setTimeout(() => {
        void (async () => {
          try {
            await setLastRestartRequest({
              updateId,
              requestedAt: new Date().toISOString(),
              chatId: sentMessage.chat.id,
              messageId: sentMessage.message_id,
              locale: getLocale(),
            });

            const tenantRestartResult = await processManager.restartTenantRuntimes();
            if (!tenantRestartResult.success) {
              restartInProgress = false;

              const errorMessage = tenantRestartResult.error || t("common.unknown_error");
              logger.error("[Bot] Deferred /restart tenant cascade failed:", errorMessage);
              await ctx.reply(t("restart.error", { error: errorMessage }), withMessageThreadId(undefined, messageThreadId));
              return;
            }

            await stopBotContainers();
            restartCurrentProcess();
          } catch (error) {
            restartInProgress = false;

            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("[Bot] Deferred /restart failed:", error);
            void ctx.reply(t("restart.error", { error: errorMessage || t("common.unknown_error") }), withMessageThreadId(undefined, messageThreadId));
          }
        })();
      }, RESTART_TRIGGER_DELAY_MS);

      timer.unref?.();
    } catch (error) {
      restartInProgress = false;

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[Bot] Error in /restart command:", error);
      await ctx.reply(t("restart.error", { error: errorMessage || t("common.unknown_error") }), withMessageThreadId(undefined, messageThreadId));
    }
  });
}
