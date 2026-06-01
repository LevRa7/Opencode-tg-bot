import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { getTenantRuntimeInfo } from "../../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../../telegram/scope.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";

export async function handleServer(ctx: Context): Promise<void> {
  const scope = getCurrentTelegramConversationScope();
  const messageThreadId = extractMessageThreadIdFromContext(ctx);

  let url = config.opencode.apiUrl;
  if (scope && scope.userId !== config.telegram.adminUserId) {
    const runtime = getTenantRuntimeInfo(scope.userId);
    if (runtime?.baseUrl) {
      url = runtime.baseUrl;
    }
  }

  await ctx.reply(t("server.info", { url }), withMessageThreadId(undefined, messageThreadId));

  try {
    const { data, error } = await opencodeClient.global.health();
    if (error || !data) {
      await ctx.reply(t("server.unavailable"), withMessageThreadId(undefined, messageThreadId));
    } else {
      await ctx.reply(t("server.healthy"), withMessageThreadId(undefined, messageThreadId));
    }
  } catch (err) {
    logger.error("[Server] Health check failed", err);
    await ctx.reply(t("server.unavailable"), withMessageThreadId(undefined, messageThreadId));
  }
}
