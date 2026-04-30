import type { CommandContext, Context } from "grammy";
import { getStoredAgent } from "../../agent/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { getRuntimeModelCatalog, selectModel } from "../../model/manager.js";
import { formatModelForDisplay, type ModelInfo } from "../../model/types.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { threadContextManager } from "../../thread/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { t } from "../../i18n/index.js";
import { showModelSelectionMenu } from "../handlers/model.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";

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
  const catalog = await getRuntimeModelCatalog();
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

  if (ctx.chat) {
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  selectModel(modelInfo);
  threadContextManager.bindModelToActiveContext(modelInfo);
  keyboardManager.updateModel(modelInfo);
  await pinnedMessageManager.refreshContextLimit();

  const contextInfo =
    pinnedMessageManager.getContextInfo() ??
    (pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
      : null);

  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  const variantName = formatVariantForButton(modelInfo.variant || "default");
  const keyboard = createMainKeyboard(
    getStoredAgent(),
    modelInfo,
    contextInfo ?? undefined,
    variantName,
  );
  const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

  await ctx.reply(
    t("model.command.changed", { name: displayName }),
    withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
  );
}
