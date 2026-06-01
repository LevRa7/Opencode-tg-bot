import { Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export async function providersCommand(ctx: Context): Promise<void> {
  try {
    const { data: providerData, error } = await opencodeClient.provider.list();

    if (error || !providerData) {
      logger.error("[Providers] Failed to list providers:", error);
      await ctx.reply(t("providers.error"));
      return;
    }

    const providerList = providerData.all ?? [];
    if (providerList.length === 0) {
      await ctx.reply(t("providers.empty"));
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const p of providerList) {
      keyboard.text(p.name ?? p.id, `provider:auth:${p.id}`).row();
    }

    await ctx.reply(t("providers.select"), { reply_markup: keyboard });
  } catch (err) {
    logger.error("[Providers] Error:", err);
    await ctx.reply(t("providers.error"));
  }
}

export async function handleProviderAuth(ctx: Context, providerId: string): Promise<void> {
  try {
    const { data, error } = await opencodeClient.provider.oauth.authorize({
      providerID: providerId,
      method: 0,
    });

    if (error) {
      logger.error("[Providers] OAuth authorize error:", error);
      await ctx.reply(t("providers.auth_error"));
      return;
    }

    const authData = data as { url?: string; instructions?: string } | undefined;
    const authUrl = authData?.url;
    if (authUrl) {
      await ctx.reply(t("providers.auth_url", { url: authUrl }));
    } else {
      await ctx.reply(t("providers.authorized"));
    }
  } catch (err) {
    logger.error("[Providers] Auth error:", err);
    await ctx.reply(t("providers.auth_error"));
  }
}
