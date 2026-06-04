import { Context } from "grammy";
import { SubdomainManager } from "./subdomain-manager.js";
import { getSubdomainsRepository } from "../settings/manager.js";

const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());

export async function showWebPanelOnboarding(ctx: Context): Promise<void> {
  const keyboard = {
    inline_keyboard: [[
      { text: "🔧 Настроить веб-панель", callback_data: "onboarding:setup_web" },
      { text: "⏭️ Пропустить", callback_data: "onboarding:skip_web" },
    ]],
  };

  await ctx.reply("Настроить доступ к веб-панели OpenCode?", { reply_markup: keyboard });
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
      `Твоя веб-панель OpenCode:`,
      ``,
      `• Адрес: ${fullDomain}`,
      `• Логин: ${info.username}`,
      `• Пароль: <code>${info.password}</code>`,
      ``,
      `Сохрани пароль. Сменить можно через /server.`,
    ].join("\n");

    await ctx.editMessageText(msg, { parse_mode: "HTML" });
  } else if (data === "onboarding:skip_web") {
    await ctx.editMessageText("Ок, настроить можно позже через /server.");
  }

  return true;
}
