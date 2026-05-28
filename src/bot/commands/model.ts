import type { CommandContext, Context } from "grammy";
import { getRuntimeModelCatalog } from "../../model/manager.js";
import type { ModelInfo } from "../../model/types.js";
import { t } from "../../i18n/index.js";
import { applySelectedModel, showModelSelectionMenu } from "../handlers/model.js";

function parseModelArgument(rawArgument: string): { providerID: string; modelID: string } | null {
  const separatorIndex = rawArgument.indexOf("/");

  if (
    separatorIndex <= 0 ||
    separatorIndex === rawArgument.length - 1 ||
    /\s/.test(rawArgument)
  ) {
    return null;
  }

  return {
    providerID: rawArgument.slice(0, separatorIndex),
    modelID: rawArgument.slice(separatorIndex + 1),
  };
}

async function findRuntimeModel(providerID: string, modelID: string): Promise<ModelInfo | null> {
  const catalog = await getRuntimeModelCatalog({ force: true });
  const provider = catalog.providers.find((item) => item.providerID === providerID);
  const modelExists = provider?.models.some((model) => model.modelID === modelID) ?? false;

  if (!modelExists) {
    return null;
  }

  return { providerID, modelID, variant: "default" };
}

export async function modelCommand(ctx: CommandContext<Context>): Promise<void> {
  const rawArgument = String(ctx.match ?? "").trim();

  if (!rawArgument) {
    await showModelSelectionMenu(ctx);
    return;
  }

  const parsedModel = parseModelArgument(rawArgument);
  if (!parsedModel) {
    await ctx.reply(t("model.command.usage"));
    return;
  }

  const modelInfo = await findRuntimeModel(parsedModel.providerID, parsedModel.modelID);
  if (!modelInfo) {
    await ctx.reply(t("model.command.not_found", { name: rawArgument }));
    return;
  }

  await applySelectedModel(ctx, modelInfo, { replyTextKey: "model.command.changed" });
}
