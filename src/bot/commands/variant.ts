import type { CommandContext, Context } from "grammy";
import { t } from "../../i18n/index.js";
import { applySelectedVariant, showVariantSelectionMenu } from "../handlers/variant.js";

export async function variantCommand(ctx: CommandContext<Context>): Promise<void> {
  const variantId = String(ctx.match ?? "").trim();

  if (!variantId) {
    await showVariantSelectionMenu(ctx);
    return;
  }

  const result = await applySelectedVariant(ctx, variantId, { replyTextKey: "variant.command.changed" });

  if (result.applied) {
    return;
  }

  if (result.reason === "model_required") {
    await ctx.reply(t("variant.command.model_required"));
    return;
  }

  await ctx.reply(t("variant.command.not_found", { name: result.variantId }));
}
