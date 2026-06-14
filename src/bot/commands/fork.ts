import * as path from "node:path";
import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { attachSessionForScope } from "../../attach/service.js";
import { threadContextManager } from "../../thread/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { resolveRepliedMessage } from "./message-journal-helpers.js";

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  return e.name === "NotFoundError" || (typeof e.message === "string" && e.message.includes("not found"));
}

export { isNotFoundError };

function looksLikeRootDirectory(dir: string): boolean {
  const normalized = path.resolve(dir);
  return normalized === "/" || normalized.length < 3;
}

export async function forkCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("fork.no_session"));
    return;
  }

  if (looksLikeRootDirectory(session.directory)) {
    logger.error(`[Fork] Invalid directory for session ${session.id}: ${session.directory}`);
    await ctx.reply(t("fork.invalid_directory"));
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
      if (isNotFoundError(error)) {
        logger.error(`[Fork] Session not found on server: ${session.id}`);
        await ctx.reply(t("fork.session_not_found"));
        return;
      }
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

      setCurrentSession({ ...session });
    }

    await ctx.reply(
      t("fork.success", { title: forkedSession.title }),
      withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
    );
  } catch (err) {
    if (isNotFoundError(err)) {
      logger.error(`[Fork] Session not found on server (thrown): ${session.id}`);
      await ctx.reply(t("fork.session_not_found"));
      return;
    }
    logger.error("[Fork] Error:", err);
    await ctx.reply(t("fork.error"));
  }
}
