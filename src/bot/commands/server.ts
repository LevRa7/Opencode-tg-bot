import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { getTenantRuntimeInfo } from "../../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../../telegram/scope.js";
import { sshManager } from "../../utils/ssh-manager.js";
import { logger } from "../../utils/logger.js";

async function getExternalUrl(): Promise<string> {
  try {
    const resp = await fetch("https://api.ipify.org?format=text", { signal: AbortSignal.timeout(3000) });
    const ip = (await resp.text()).trim();
    if (ip) return `http://${ip}:4096`;
  } catch {}
  return "";
}

export async function handleServer(ctx: Context): Promise<void> {
  const scope = getCurrentTelegramConversationScope();
  let url = "";

  if (scope && sshManager.isSshActive(scope.userId)) {
    const conn = sshManager.getActiveConnection(scope.userId);
    const details = conn?.details;
    if (details) {
      url = `ssh://${details.username}@${details.host}:${details.port ?? 22} (Docker)`;
      // Also show the external IP
      const extUrl = await getExternalUrl();
      if (extUrl) url += `\nExternal: ${extUrl}`;
    }
  }

  if (!url) {
    url = config.opencode.apiUrl;
    // Try to replace localhost with external IP
    if (url.includes("localhost") || url.includes("127.0.0.1")) {
      const extUrl = await getExternalUrl();
      if (extUrl) url += `\nExternal: ${extUrl}`;
    }
    if (scope && scope.userId !== config.telegram.adminUserId) {
      const runtime = getTenantRuntimeInfo(scope.userId);
      url = runtime?.baseUrl || url;
    }
  }

  await ctx.reply(t("server.info", { url }));

  try {
    const { data, error } = await opencodeClient.global.health();
    if (error || !data) {
      await ctx.reply(t("server.unavailable"));
    } else {
      await ctx.reply(t("server.healthy"));
      const pw = config.opencode.password || "(not set)";
      if (config.opencode.username) {
        await ctx.reply(
          t("server.credentials", {
            user: config.opencode.username,
            pass: pw,
          }),
          { parse_mode: "MarkdownV2" }
        );
      }
    }
  } catch {
    await ctx.reply(t("server.unavailable"));
  }
}
