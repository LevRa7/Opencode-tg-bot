import type { Context } from "grammy";
import { isMessageStreamingEnabled, setMessageStreamingEnabled } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";

function getStreamArgument(ctx: Context): string {
  const text = ctx.message?.text ?? "";
  const [, ...parts] = text.trim().split(/\s+/);
  return (parts[0] ?? "status").toLowerCase();
}

export async function streamCommand(ctx: Context): Promise<void> {
  const argument = getStreamArgument(ctx);

  if (argument === "on") {
    await setMessageStreamingEnabled(true);
    await ctx.reply(t("stream.enabled"));
    return;
  }

  if (argument === "off") {
    await setMessageStreamingEnabled(false);
    await ctx.reply(t("stream.disabled"));
    return;
  }

  if (argument === "status") {
    await ctx.reply(
      isMessageStreamingEnabled() ? t("stream.status_enabled") : t("stream.status_disabled"),
    );
    return;
  }

  await ctx.reply(t("stream.usage"));
}
