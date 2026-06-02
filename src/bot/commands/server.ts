import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { getTenantRuntimeInfo } from "../../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../../telegram/scope.js";
import { sshManager } from "../../utils/ssh-manager.js";

async function getExternalUrl(): Promise<string> {
  try {
    const resp = await fetch("https://api.ipify.org?format=text", { signal: AbortSignal.timeout(3000) });
    const ip = (await resp.text()).trim();
    if (ip) return `http://${ip}:4096`;
  } catch {}
  return "";
}

function escapeMd2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

export async function handleServer(ctx: Context): Promise<void> {
  const scope = getCurrentTelegramConversationScope();
  let serverUrl = "";
  let externalUrl = "";

  if (scope && sshManager.isSshActive(scope.userId)) {
    const conn = sshManager.getActiveConnection(scope.userId);
    const d = conn?.details;
    if (d) {
      const target = conn?.deployTarget === "docker" ? "Docker" : "Host";
      serverUrl = `ssh://${d.username}@${d.host}:${d.port ?? 22} (${target})`;
      externalUrl = `http://${d.host}:${conn!.remotePort}`;
    }
  }

  if (!serverUrl) {
    serverUrl = config.opencode.apiUrl;
    if (serverUrl.includes("localhost") || serverUrl.includes("127.0.0.1")) {
      externalUrl = await getExternalUrl();
    }
    if (scope && scope.userId !== config.telegram.adminUserId) {
      const runtime = getTenantRuntimeInfo(scope.userId);
      serverUrl = runtime?.baseUrl || serverUrl;
    }
  }

  let healthStatus: string;
  let credsBlock = "";
  try {
    const { data, error } = await opencodeClient.global.health();
    if (error || !data) {
      healthStatus = "\u274c " + t("server.unavailable");
    } else {
      healthStatus = "\u2705 " + t("server.healthy");
      const pw = config.opencode.password || "(not set)";
      if (config.opencode.username) {
        credsBlock = "\n" + t("server.credentials", {
          user: escapeMd2(config.opencode.username),
          pass: escapeMd2(pw),
        });
      }
    }
  } catch {
    healthStatus = "\u274c " + t("server.unavailable");
  }

  // Escape all parts for MarkdownV2, but preserve ||...|| spoiler syntax
  const infoLine = t("server.info", { url: escapeMd2(serverUrl) });
  const extLine = externalUrl ? "External: " + escapeMd2(externalUrl) : "";
  const statusLine = escapeMd2(healthStatus);

  const parts = [infoLine, extLine, statusLine].filter(Boolean);
  let finalMsg = parts.join("\n");
  if (credsBlock) {
    finalMsg += credsBlock;
  }

  await ctx.reply(finalMsg, { parse_mode: "MarkdownV2" });
}
