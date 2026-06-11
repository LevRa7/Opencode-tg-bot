import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { getMessageJournalRepo } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { resolveRepliedMessage } from "./message-journal-helpers.js";

export async function revertCommand(ctx: Context): Promise<void> {
  const repliedMessage = resolveRepliedMessage(ctx);
  if (!repliedMessage) {
    await ctx.reply(t("revert.no_reply"));
    return;
  }

  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("revert.no_session"));
    return;
  }

  try {
    const { error } = await opencodeClient.session.revert({
      sessionID: repliedMessage.oc_session_id,
      messageID: repliedMessage.oc_message_id,
      directory: session.directory,
    });

    if (error) {
      logger.error("[Revert] Failed:", error);
      await ctx.reply(t("revert.error"));
      return;
    }

    logger.info(
      `[Revert] Reverted session=${repliedMessage.oc_session_id} to message=${repliedMessage.oc_message_id}`,
    );

    // Delete TG messages after the revert point
    const chatId = ctx.chat!.id;
    const topicId = extractMessageThreadIdFromContext(ctx) ?? null;
    const repo = getMessageJournalRepo();
    const topicMessages = repo.findByTgTopic(chatId, topicId);
    const revertTgMsgId = repliedMessage.tg_message_id;

    for (const row of topicMessages) {
      if (row.tg_message_id > revertTgMsgId) {
        try {
          await ctx.api.deleteMessage(chatId, row.tg_message_id);
          repo.deleteByTgMessage(row.tg_message_id, chatId, row.tg_topic_id);
        } catch (err) {
          logger.warn(`[Revert] Failed to delete TG message ${row.tg_message_id}:`, err);
        }
      }
    }

    await ctx.reply(
      t("revert.success"),
      withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
    );
  } catch (err) {
    logger.error("[Revert] Error:", err);
    await ctx.reply(t("revert.error"));
  }
}
