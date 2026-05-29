import type { CommandContext, Context } from "grammy";
import { getCurrentSession } from "../../session/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { logger } from "../../utils/logger.js";
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

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const storedModel = getStoredModel();

    logger.debug(
      `[CompactCommand] Calling summarize: session=${session.id}, model=${storedModel.providerID}/${storedModel.modelID}`,
    );

    const { error } = await opencodeClient.session.summarize({
      sessionID: session.id,
      directory: session.directory,
      providerID: storedModel.providerID,
      modelID: storedModel.modelID,
    });

    if (error) {
      logger.error("[CompactCommand] Compact failed:", error);
      await ctx.api
        .editMessageText(ctx.chat!.id, progressMessage.message_id, t("context.error"))
        .catch(() => {});
      return;
    }

    logger.info(`[CompactCommand] Session compacted: ${session.id}`);
    await ctx.api.deleteMessage(ctx.chat!.id, progressMessage.message_id).catch(() => {});

    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }
    const keyboard = keyboardManager.getKeyboard();
    await ctx.reply(
      t("context.success"),
      withMessageThreadId(keyboard ? { reply_markup: keyboard } : undefined, messageThreadId),
    );
  } catch (err) {
    logger.error("[CompactCommand] Compact exception:", err);
    await ctx.api
      .editMessageText(ctx.chat!.id, progressMessage.message_id, t("context.error"))
      .catch(() => {});
  }
}
