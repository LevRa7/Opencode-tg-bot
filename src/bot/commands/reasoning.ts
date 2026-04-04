import { CommandContext, Context } from "grammy";
import { getReasoningMode, setReasoningMode, ReasoningMode } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";

export async function reasoningCommand(ctx: CommandContext<Context>): Promise<void> {
  const arg = ctx.match?.trim();

  if (!arg) {
    const currentMode = getReasoningMode();
    const message = [
      t("reasoning.title"),
      t("reasoning.current", { mode: String(currentMode) }),
      "",
      t("reasoning.mode_0"),
      t("reasoning.mode_1"),
      t("reasoning.mode_2"),
      t("reasoning.mode_3"),
      "",
      "Usage: /reasoning 0/1/2/3"
    ].join("\n");
    await ctx.reply(message);
    return;
  }

  const mode = parseInt(arg, 10);
  if (isNaN(mode) || mode < 0 || mode > 3) {
    await ctx.reply("❌ Invalid mode. Use 0, 1, 2, or 3.");
    return;
  }

  setReasoningMode(mode as ReasoningMode);
  await ctx.reply(t("reasoning.updated", { mode: String(mode) }));
}
