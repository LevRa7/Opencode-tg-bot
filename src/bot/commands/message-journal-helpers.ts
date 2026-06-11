import type { Context } from "grammy";
import { getMessageJournalRepo } from "../../settings/manager.js";
import { extractMessageThreadIdFromContext } from "../utils/message-thread.js";
import type { MessageJournalRow } from "../../settings/repositories/message-journal.js";

export function resolveRepliedMessage(
  ctx: Context,
): MessageJournalRow | null {
  const replyTarget = ctx.message?.reply_to_message;
  if (!replyTarget?.message_id) return null;

  const chatId = ctx.chat!.id;
  const topicId = extractMessageThreadIdFromContext(ctx) ?? null;

  return getMessageJournalRepo().findByTgMessage(
    replyTarget.message_id,
    chatId,
    topicId,
  );
}
