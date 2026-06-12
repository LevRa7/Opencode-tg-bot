import { Context } from "grammy";
import { SubdomainManager } from "../../server/subdomain-manager.js";
import { getSubdomainsRepository } from "../../settings/manager.js";
import { resolveOpencodeRouteForUser } from "../../server/route-resolver.js";
import { processManager } from "../../process/manager.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";

const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());

export async function serverWebCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const route = resolveOpencodeRouteForUser(userId);

  const info = subdomainManager.getSubdomainByUserId(userId);

  if (!info) {
    await ctx.reply(t("server_web.not_configured"), { parse_mode: "HTML" });
    return;
  }

  // Auto-heal: if SSH is not active but the subdomain still has the SSH
  // "host.name" format, reset it to the base username-based subdomain.
  const isSshKind = route?.kind === "ssh-host" || route?.kind === "ssh-docker";
  const hasSshFormatSubdomain =
    !isSshKind && info.subdomain !== info.subdomain.replace(/^[^.]+\./, "");

  let displaySubdomain = info.subdomain;
  let displayKind = route?.kind ?? info.kind;

  if (hasSshFormatSubdomain) {
    const fixed = subdomainManager.ensureSubdomain(
      userId,
      ctx.from?.username,
      route?.kind === "tenant" ? "tenant" : "host",
    );
    displaySubdomain = fixed.subdomain;
    displayKind = fixed.kind;
  }

  const fullDomain = `${displaySubdomain}.smart-server.online`;

  const lines = [
    `<b>${t("server_web.title")}</b>`,
    ``,
    `${t("server_web.label_url")} <code>https://${fullDomain}</code>`,
    `${t("server_web.label_login")} <code>opencode</code>`,
    `${t("server_web.label_password")} <code>${route?.password || "—"}</code>`,
    `${t("server_web.label_type")} ${displayKind}`,
  ];
  if (isSshKind && info.hostname) {
    lines.push(`${t("server_web.label_host")} ${info.hostname}`);
  }

  const keyboard = {
    inline_keyboard: [[
      { text: t("server_web.button.open"), url: `https://${fullDomain}` },
      { text: t("server_web.button.change_password"), callback_data: "server:regen_pw" },
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
      await ctx.answerCallbackQuery({ text: t("server_web.password_updated"), show_alert: true });
      await ctx.reply(
        t("server_web.new_password_message", { password: newPassword }),
        { parse_mode: "HTML" },
      );
      if (userId === config.telegram.adminUserId) {
        await processManager.stop();
        await processManager.start();
      } else {
        await processManager.restartTenantRuntimes();
      }
    } else {
      await ctx.answerCallbackQuery({ text: t("server_web.error_not_configured"), show_alert: true });
    }
  }

  return true;
}
