import { Context } from "grammy";
import { SubdomainManager } from "../../server/subdomain-manager.js";
import { getSubdomainsRepository } from "../../settings/manager.js";
import { resolveOpencodeRouteForUser } from "../../server/route-resolver.js";

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
    const crypto = await import("node:crypto");
    const newPassword = crypto.randomBytes(12).toString("base64url").slice(0, 16);
    const { getOrCreateServerPassword, setServerPassword } = await import("../../settings/manager.js");
    setServerPassword(userId, newPassword);
    const pw = getOrCreateServerPassword(userId, newPassword);
    if (pw) {
      await ctx.answerCallbackQuery({ text: "Пароль обновлён", show_alert: true });
      await ctx.reply(
        `Новый пароль: <code>${pw}</code>\n\n<i>Может потребоваться перезапуск OpenCode сервера</i>`,
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.answerCallbackQuery({ text: "Ошибка", show_alert: true });
    }
  }

  return true;
}
