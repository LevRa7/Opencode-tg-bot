import type { Context } from "grammy";
import { isMessageStreamingEnabled, setMessageStreamingEnabled } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";

function getStreamArgument(ctx: Context): string {
  const text = ctx.message?.text ?? "";
  const [, ...parts] = text.trim().split(/\s+/);
  return (parts[0] ?? "status").toLowerCase();
}

export async function streamCommand(ctx: Context): Promise<void> {
  const argument = getStreamArgument(ctx);
  const messageThreadId = extractMessageThreadIdFromContext(ctx);

  if (argument === "on") {
    await setMessageStreamingEnabled(true);
    await ctx.reply(t("stream.enabled"), withMessageThreadId(undefined, messageThreadId));
    return;
  }

  if (argument === "off") {
    await setMessageStreamingEnabled(false);
    await ctx.reply(t("stream.disabled"), withMessageThreadId(undefined, messageThreadId));
    return;
  }

  if (argument === "status") {
    await ctx.reply(
      isMessageStreamingEnabled() ? t("stream.status_enabled") : t("stream.status_disabled"),
      withMessageThreadId(undefined, messageThreadId),
    );
    return;
  }

  await ctx.reply(t("stream.usage"), withMessageThreadId(undefined, messageThreadId));
}
