import { Context } from "grammy";
import { SubdomainManager } from "../../server/subdomain-manager.js";
import { getSubdomainsRepository } from "../../settings/manager.js";
import { resolveOpencodeRouteForUser } from "../../server/route-resolver.js";
import { processManager } from "../../process/manager.js";
import { config } from "../../config.js";

const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());

export async function serverWebCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const info = subdomainManager.getSubdomainByUserId(userId);

  if (!info) {
    await ctx.reply("Веб-панель не настроена. Используй /start для настройки.", { parse_mode: "HTML" });
    return;
  }

  const fullDomain = `${info.subdomain}.smart-server.online`;
  const route = resolveOpencodeRouteForUser(userId);

  const lines = [
    `<b>Веб-панель OpenCode</b>`,
    ``,
    `Адрес: <code>https://${fullDomain}</code>`,
    `Логин: <code>opencode</code>`,
    `Пароль: <code>${route?.password || "—"}</code>`,
    `Тип: ${info.kind}`,
  ];
  if (info.hostname) {
    lines.push(`Хост: ${info.hostname}`);
  }

  const keyboard = {
    inline_keyboard: [[
      { text: "Открыть", url: `https://${fullDomain}` },
      { text: "Сменить пароль", callback_data: "server:regen_pw" },
    ]],
  };

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
}

export async function handleServerCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("server:")) return false;

  const userId = ctx.from?.id;
  if (!userId) return false;

  if (data === "server:regen_pw") {
    const newPassword = subdomainManager.regeneratePassword(userId);
    if (newPassword) {
      await ctx.answerCallbackQuery({ text: "Пароль обновлён, перезапускаю сервер...", show_alert: true });
      await ctx.reply(
        `Новый пароль: <code>${newPassword}</code>\n\n<i>Перезапускаю сервер...</i>`,
        { parse_mode: "HTML" },
      );
      if (userId === config.telegram.adminUserId) {
        await processManager.stop();
        await processManager.start();
      } else {
        await processManager.restartTenantRuntimes();
      }
    } else {
      await ctx.answerCallbackQuery({ text: "Ошибка: веб-панель не настроена", show_alert: true });
    }
  }

  return true;
}
