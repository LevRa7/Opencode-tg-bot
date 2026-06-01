import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { getTenantRuntimeInfo } from "../../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../../telegram/scope.js";

export async function handleServer(ctx: Context): Promise<void> {
  const scope = getCurrentTelegramConversationScope();
  let url = config.opencode.apiUrl;

  if (scope && scope.userId !== config.telegram.adminUserId) {
    const runtime = getTenantRuntimeInfo(scope.userId);
    url = runtime?.baseUrl || url;
  }

  await ctx.reply(t("server.info", { url }));

  try {
    const { data, error } = await opencodeClient.global.health();
    if (error || !data) {
      await ctx.reply(t("server.unavailable"));
    } else {
      await ctx.reply(t("server.healthy"));
    }
  } catch {
    await ctx.reply(t("server.unavailable"));
  }
}
