import type { CommandContext, Context } from "grammy";
import { getStoredModel } from "../../model/manager.js";
import { getAvailableVariants } from "../../variant/manager.js";
import { t } from "../../i18n/index.js";
import { applySelectedVariant, showVariantSelectionMenu } from "../handlers/variant.js";

function hasEffectiveModel(model: { providerID?: string; modelID?: string }): model is {
  providerID: string;
  modelID: string;
} {
  return Boolean(model.providerID && model.modelID);
}

export async function variantCommand(ctx: CommandContext<Context>): Promise<void> {
  const variantId = String(ctx.match ?? "").trim();

  if (!variantId) {
    await showVariantSelectionMenu(ctx);
    return;
  }

  const currentModel = getStoredModel();
  if (!hasEffectiveModel(currentModel)) {
    await ctx.reply(t("variant.command.model_required"));
    return;
  }

  const variants = await getAvailableVariants(currentModel.providerID, currentModel.modelID);
  const requestedVariant = variants.find((variant) => variant.id === variantId && !variant.disabled);

  if (!requestedVariant) {
    await ctx.reply(t("variant.command.not_found", { name: variantId }));
    return;
  }

  await applySelectedVariant(ctx, variantId, { replyTextKey: "variant.command.changed" });
}
