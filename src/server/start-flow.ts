import { Context } from "grammy";
import { SubdomainManager } from "./subdomain-manager.js";
import { getSubdomainsRepository } from "../settings/manager.js";
import { t } from "../i18n/index.js";

const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());

export async function showWebPanelOnboarding(ctx: Context): Promise<void> {
  const keyboard = {
    inline_keyboard: [[
      { text: t("onboarding.setup_web_panel"), callback_data: "onboarding:setup_web" },
      { text: t("onboarding.skip"), callback_data: "onboarding:skip_web" },
    ]],
  };

  await ctx.reply(t("onboarding.prompt"), { reply_markup: keyboard });
}

export async function handleOnboardingCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("onboarding:")) return false;
  const userId = ctx.from?.id;
  if (!userId) return false;

  if (data === "onboarding:setup_web") {
    const username = ctx.from?.username;
    const info = subdomainManager.ensureSubdomain(userId, username, "host");
    const fullDomain = `${info.subdomain}.smart-server.online`;

    const msg = [
      t("onboarding.your_web_panel"),
      ``,
      `• ${t("server_web.label_url")} ${fullDomain}`,
      `• ${t("server_web.label_login")} ${info.username}`,
      `• ${t("server_web.label_password")} <code>${info.password}</code>`,
      ``,
      t("onboarding.save_password_hint"),
    ].join("\n");

    await ctx.editMessageText(msg, { parse_mode: "HTML" });
    return true;
  }

  if (data === "onboarding:skip_web") {
    await ctx.editMessageText(t("onboarding.skipped"));
    return true;
  }

  return false;
}
