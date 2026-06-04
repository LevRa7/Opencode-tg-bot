/**
 * /goal command — standing goal management (Ralph loop).
 *
 * Ported from Hermes Agent goals.py.
 *
 * Subcommands:
 *   /goal <text>     — set a new goal and kick off the loop
 *   /goal status     — show current goal status
 *   /goal pause      — pause the active goal
 *   /goal resume     — resume a paused goal
 *   /goal clear      — clear the current goal
 */

import type { CommandContext, Context } from "grammy";
import { getGoalManager } from "../goal/context.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { getCurrentSession } from "../../session/manager.js";

export async function goalCommand(ctx: CommandContext<Context>) {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    // Extract subcommand: everything after "/goal"
    const messageText = ctx.message?.text ?? "";
    const args = messageText.replace(/^\/goal\s*/, "").trim();

    const manager = getGoalManager(ctx);

    if (!args || args === "status") {
      // Show status
      const statusLine = manager.statusLine();
      await ctx.reply(statusLine);
      return;
    }

    const lowerArgs = args.toLowerCase();

    if (lowerArgs === "pause") {
      manager.pause("user-paused");
      await ctx.reply(t("goal.paused"));
      return;
    }

    if (lowerArgs === "resume") {
      manager.resume(true);
      await ctx.reply(t("goal.resumed"));
      return;
    }

    if (lowerArgs === "clear") {
      manager.clear();
      await ctx.reply(t("goal.cleared"));
      return;
    }

    // Otherwise, treat args as the goal text
    const session = getCurrentSession();
    if (!session) {
      await ctx.reply(t("goal.no_session"));
      return;
    }

    manager.set(args);
    await ctx.reply(t("goal.set", { goal: args, maxTurns: String(manager.state!.maxTurns) }));

    // Goal set — user sends a message to kick off the first turn
  } catch (error) {
    logger.error("[Goal] Command error:", error);
    await ctx.reply(t("goal.error"));
  }
}
