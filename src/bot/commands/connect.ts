import { Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export async function connectCommand(ctx: Context): Promise<void> {
  try {
    const { data: providerData, error } = await opencodeClient.provider.list();

    if (error || !providerData) {
      logger.error("[Connect] Failed to list providers:", error);
      await ctx.reply(t("connect.error"));
      return;
    }

    const providerList = (providerData as any)?.all ?? [];
    if (providerList.length === 0) {
      await ctx.reply(t("connect.empty"));
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const p of providerList) {
      keyboard.text(p.name ?? p.id, `provider:auth:${p.id}`).row();
    }

    await ctx.reply(t("connect.select"), { reply_markup: keyboard });
  } catch (err) {
    logger.error("[Connect] Error:", err);
    await ctx.reply(t("connect.error"));
  }
}

export async function handleProviderAuth(ctx: Context, providerId: string): Promise<void> {
  try {
    const { data, error } = await opencodeClient.provider.oauth.authorize({
      providerID: providerId,
      method: 0,
    });

    if (error) {
      logger.error("[Connect] OAuth authorize error:", error);
      await ctx.reply(t("connect.auth_error"));
      return;
    }

    const authData = data as { url?: string; instructions?: string } | undefined;
    const authUrl = authData?.url;
    if (authUrl) {
      await ctx.reply(t("connect.auth_url", { url: authUrl }));
    } else {
      await ctx.reply(t("connect.authorized"));
    }
  } catch (err) {
    logger.error("[Connect] Auth error:", err);
    await ctx.reply(t("connect.auth_error"));
  }
}
