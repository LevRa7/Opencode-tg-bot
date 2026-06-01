import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export async function shareCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("share.no_session"));
    return;
  }

  try {
    const { data, error } = await opencodeClient.session.share({
      sessionID: session.id,
      directory: session.directory,
    });

    if (error) {
      logger.error("[Share] Failed to share session:", error);
      await ctx.reply(t("share.error"));
      return;
    }

    const shareUrl = (data as any)?.share?.url;
    if (shareUrl) {
      await ctx.reply(t("share.success", { url: shareUrl }));
    } else {
      await ctx.reply(t("share.success", { url: "Session is now shared" }));
    }
  } catch (err) {
    logger.error("[Share] Error:", err);
    await ctx.reply(t("share.error"));
  }
}

export async function unshareCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("share.no_session"));
    return;
  }

  try {
    const { error } = await opencodeClient.session.unshare({
      sessionID: session.id,
      directory: session.directory,
    });

    if (error) {
      await ctx.reply(t("share.unshare_error"));
      return;
    }

    await ctx.reply(t("share.unshared"));
  } catch (err) {
    await ctx.reply(t("share.unshare_error"));
  }
}
