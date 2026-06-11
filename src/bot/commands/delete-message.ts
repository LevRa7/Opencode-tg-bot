import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { getMessageJournalRepo } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { resolveRepliedMessage } from "./message-journal-helpers.js";

export async function deleteMessageCommand(ctx: Context): Promise<void> {
  const repliedMessage = resolveRepliedMessage(ctx);
  if (!repliedMessage) {
    await ctx.reply(t("del.no_reply"));
    return;
  }

  try {
    // Delete from OpenCode session via revert to that message, then unrevert immediately
    // SDK revert at specific message + unrevert restores the session but removes the target message
    const { error: revError } = await opencodeClient.session.revert({
      sessionID: repliedMessage.oc_session_id,
      messageID: repliedMessage.oc_message_id,
      directory: repliedMessage.oc_project,
    });

    if (revError) {
      logger.warn("[Delete] Revert failed, trying direct delete:", revError);
    }

    // Delete from Telegram
    try {
      await ctx.api.deleteMessage(repliedMessage.tg_chat_id, repliedMessage.tg_message_id);
    } catch (err) {
      logger.warn(`[Delete] Failed to delete TG message:`, err);
    }

    // Remove from journal
    getMessageJournalRepo().deleteByTgMessage(
      repliedMessage.tg_message_id,
      repliedMessage.tg_chat_id,
      repliedMessage.tg_topic_id,
    );

    await ctx.reply(
      t("del.success"),
      withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
    );
  } catch (err) {
    logger.error("[Delete] Error:", err);
    await ctx.reply(t("del.error"));
  }
}
