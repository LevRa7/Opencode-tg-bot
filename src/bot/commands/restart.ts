import { CommandContext, Context } from "grammy";
import { t } from "../../i18n/index.js";
import { restartCurrentProcess } from "../../runtime/restart.js";
import { getLastRestartRequest, setLastRestartRequest } from "../../settings/manager.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";

let restartInProgress = false;
const RESTART_TRIGGER_DELAY_MS = 1500;

export function __resetRestartStateForTests(): void {
  restartInProgress = false;
}

export async function restartCommand(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.from?.id !== config.telegram.adminUserId) {
    await ctx.reply(t("restart.admin_only"));
    return;
  }

  const updateId = ctx.update.update_id;
  const lastRestartRequest = getLastRestartRequest();

  if (lastRestartRequest?.updateId === updateId) {
    logger.warn(`[Bot] Ignoring duplicate /restart update_id=${updateId}`);
    return;
  }

  if (restartInProgress) {
    await ctx.reply(t("restart.in_progress"));
    return;
  }

  try {
    restartInProgress = true;
    logger.info(`[Bot] Restart requested by user=${ctx.from?.id ?? "unknown"}`);
    await setLastRestartRequest({
      updateId,
      requestedAt: new Date().toISOString(),
    });

    await ctx.reply(t("restart.restarting"));

    const timer = setTimeout(() => {
      try {
        restartCurrentProcess();
      } catch (error) {
        restartInProgress = false;

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("[Bot] Deferred /restart failed:", error);
        void ctx.reply(t("restart.error", { error: errorMessage || t("common.unknown_error") }));
      }
    }, RESTART_TRIGGER_DELAY_MS);

    timer.unref?.();
  } catch (error) {
    restartInProgress = false;

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[Bot] Error in /restart command:", error);
    await ctx.reply(t("restart.error", { error: errorMessage || t("common.unknown_error") }));
  }
}
