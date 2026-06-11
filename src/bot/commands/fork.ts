import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { attachSessionForScope } from "../../attach/service.js";
import { threadContextManager } from "../../thread/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { resolveRepliedMessage } from "./message-journal-helpers.js";

export async function forkCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("fork.no_session"));
    return;
  }

  try {
    const repliedMessage = resolveRepliedMessage(ctx);

    const { data, error } = await opencodeClient.session.fork({
      sessionID: session.id,
      directory: session.directory,
      messageID: repliedMessage?.oc_message_id,
    });

    if (error || !data) {
      logger.error("[Fork] Failed to fork session:", error);
      await ctx.reply(t("fork.error"));
      return;
    }

    const forkedSession = data as { id: string; title: string };
    logger.info(
      `[Fork] Forked session=${session.id} -> ${forkedSession.id}` +
        (repliedMessage ? ` at message=${repliedMessage.oc_message_id}` : ""),
    );

    const chatId = ctx.chat!.id;
    const topicName = `[Fork] ${forkedSession.title}`;
    const newTopic = await ctx.api.createForumTopic(chatId, topicName);

    const activeScope = threadContextManager.getActiveScope();
    if (activeScope) {
      await attachSessionForScope({
        scope: { ...activeScope, messageThreadId: newTopic.message_thread_id },
        session: {
          id: forkedSession.id,
          title: forkedSession.title,
          directory: session.directory,
        },
        reason: "fork",
      });
    }

    await ctx.reply(
      t("fork.success", { title: forkedSession.title }),
      withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
    );
  } catch (err) {
    logger.error("[Fork] Error:", err);
    await ctx.reply(t("fork.error"));
  }
}
