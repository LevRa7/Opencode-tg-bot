import { Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export async function connectCommand(ctx: Context): Promise<void> {
  try {
    const project = getCurrentProject();
    const { data: providerData, error } = await opencodeClient.provider.list({
      directory: project?.worktree,
    });

    if (error || !providerData) {
      await ctx.reply(t("connect.error"));
      return;
    }

    const providerList = (providerData as any)?.all ?? (providerData as any)?.providers ?? [];
    if (providerList.length === 0) {
      await ctx.reply(t("connect.empty"));
      return;
    }

    let text = "";
    for (const p of providerList) {
      const name = p.name ?? p.id ?? "unknown";
      const models = p.models?.length ? p.models.join(", ") : "—";
      text += `🔹 <b>${name}</b>\n   Models: ${models}\n\n`;
    }
    text += "Configure providers via opencode.json or the OpenCode Web UI.";

    await ctx.reply(text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error("[Connect] Error:", err);
    await ctx.reply(t("connect.error"));
  }
}

export async function handleProviderAuth(_ctx: Context, _providerId: string): Promise<void> {
  // No-op: provider auth is handled via opencode.json config or Web UI
}
