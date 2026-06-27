import type { CommandContext, Context } from "grammy";
import { getCurrentSession } from "../../session/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";
import { keyboardManager } from "../../keyboard/manager.js";

export async function compactCommand(ctx: CommandContext<Context>): Promise<void> {
  const messageThreadId = extractMessageThreadIdFromContext(ctx);
  const session = getCurrentSession();

  if (!session) {
    await ctx.reply(
      t("context.no_active_session"),
      withMessageThreadId(undefined, messageThreadId),
    );
    return;
  }

  const progressMessage = await ctx.reply(
    t("context.progress"),
    withMessageThreadId(undefined, messageThreadId),
  );

  const chatId = ctx.chat!.id;
  const storedModel = getStoredModel();

  logger.debug(
    `[CompactCommand] Calling summarize: session=${session.id}, model=${storedModel.providerID}/${storedModel.modelID}`,
  );

  await ctx.api.sendChatAction(chatId, "typing");

  // CRITICAL: offload summarize() to background so grammY can process other updates.
  // Without this, the handler blocks until summarize completes (30–60+ sec),
  // preventing all other users' messages from being processed.
  safeBackgroundTask({
    taskName: "session.summarize",
    task: () =>
      opencodeClient.session.summarize({
        sessionID: session.id,
        directory: session.directory,
        providerID: storedModel.providerID,
        modelID: storedModel.modelID,
      }),
    onSuccess: async ({ error }) => {
      if (error) {
        logger.error("[CompactCommand] Compact failed:", error);
        await ctx.api
          .editMessageText(chatId, progressMessage.message_id, t("context.error"))
          .catch(() => {});
        return;
      }

      logger.info(`[CompactCommand] Session compacted: ${session.id}`);
      await ctx.api.deleteMessage(chatId, progressMessage.message_id).catch(() => {});

      keyboardManager.initialize(ctx.api, chatId);
      const keyboard = keyboardManager.getKeyboard();
      await ctx.api.sendMessage(chatId, t("context.success"), {
        ...withMessageThreadId(keyboard ? { reply_markup: keyboard } : undefined, messageThreadId),
      });
    },
    onError: async (err) => {
      logger.error("[CompactCommand] Compact exception:", err);
      await ctx.api
        .editMessageText(chatId, progressMessage.message_id, t("context.error"))
        .catch(() => {});
    },
  });
}
