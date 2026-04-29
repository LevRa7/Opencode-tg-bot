import type { Context } from "grammy";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { t } from "../../i18n/index.js";
import { extractTelegramConversationScopeFromContext } from "../../telegram/scope.js";

export function isForegroundBusy(ctx?: Context): boolean {
  const scope = ctx ? extractTelegramConversationScopeFromContext(ctx) : undefined;
  return foregroundSessionState.isBusyForScope(scope);
}

export async function replyBusyBlocked(ctx: Context): Promise<void> {
  const message = t("interaction.blocked.finish_current");

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: message }).catch(() => {});
    return;
  }

  if (ctx.chat) {
    await ctx.reply(message).catch(() => {});
  }
}
