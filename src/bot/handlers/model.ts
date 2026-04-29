import { Context, InlineKeyboard } from "grammy";
import {
  fetchCurrentModel,
  getRuntimeModelCatalog,
  selectModel,
} from "../../model/manager.js";
import {
  formatModelForButton,
  formatModelForDisplay,
  type ModelInfo,
  type RuntimeModelCatalog,
  type RuntimeModelCatalogProvider,
} from "../../model/types.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { logger } from "../../utils/logger.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getStoredAgent } from "../../agent/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { t } from "../../i18n/index.js";
import { threadContextManager } from "../../thread/manager.js";
import {
  extractMessageThreadIdFromContext,
  withMessageThreadId,
} from "../utils/message-thread.js";

const MODELS_PER_PAGE = 10;
const MODEL_CALLBACK_PREFIX = "model:";
const MODEL_PROVIDER_CALLBACK_PREFIX = "model_provider:";
const MODEL_PROVIDER_PAGE_CALLBACK_PREFIX = "model_provider_page:";
const MODEL_BACK_CALLBACK = "model_back";

function encodeCallbackToken(value: string): string {
  return encodeURIComponent(value);
}

function decodeCallbackToken(value: string): string {
  return decodeURIComponent(value);
}

function tryDecodeCallbackToken(value: string): string | null {
  try {
    return decodeCallbackToken(value);
  } catch {
    return null;
  }
}

function isModelMenuCallback(data: string): boolean {
  return (
    data.startsWith(MODEL_CALLBACK_PREFIX) ||
    data.startsWith(MODEL_PROVIDER_CALLBACK_PREFIX) ||
    data.startsWith(MODEL_PROVIDER_PAGE_CALLBACK_PREFIX) ||
    data === MODEL_BACK_CALLBACK
  );
}

function getCurrentModelDisplay(currentModel: ModelInfo): string {
  if (!currentModel.providerID || !currentModel.modelID) {
    return t("common.unknown");
  }

  return formatModelForDisplay(currentModel.providerID, currentModel.modelID);
}

function buildProviderCallback(providerID: string): string {
  return `${MODEL_PROVIDER_CALLBACK_PREFIX}${encodeCallbackToken(providerID)}`;
}

function buildProviderPageCallback(providerID: string, page: number): string {
  return `${MODEL_PROVIDER_PAGE_CALLBACK_PREFIX}${encodeCallbackToken(providerID)}:${page}`;
}

function parseProviderPageCallback(data: string): { providerID: string; page: number } | null {
  if (!data.startsWith(MODEL_PROVIDER_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const payload = data.slice(MODEL_PROVIDER_PAGE_CALLBACK_PREFIX.length);
  const separatorIndex = payload.lastIndexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const encodedProviderID = payload.slice(0, separatorIndex);
  const rawPage = payload.slice(separatorIndex + 1);
  const page = Number(rawPage);

  if (!encodedProviderID || !Number.isInteger(page) || page < 0) {
    return null;
  }

  const providerID = tryDecodeCallbackToken(encodedProviderID);
  if (!providerID) {
    return null;
  }

  return { providerID, page };
}

function parseProviderCallback(data: string): string | null {
  if (!data.startsWith(MODEL_PROVIDER_CALLBACK_PREFIX)) {
    return null;
  }

  const encodedProviderID = data.slice(MODEL_PROVIDER_CALLBACK_PREFIX.length);
  if (encodedProviderID.length === 0) {
    return null;
  }

  return tryDecodeCallbackToken(encodedProviderID);
}

function parseModelCallback(data: string): { providerID: string; modelID: string } | null {
  if (!data.startsWith(MODEL_CALLBACK_PREFIX)) {
    return null;
  }

  const payload = data.slice(MODEL_CALLBACK_PREFIX.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const providerID = tryDecodeCallbackToken(payload.slice(0, separatorIndex));
  const modelID = tryDecodeCallbackToken(payload.slice(separatorIndex + 1));

  if (!providerID || !modelID) {
    return null;
  }

  return { providerID, modelID };
}

function findProvider(
  catalog: RuntimeModelCatalog,
  providerID: string,
): RuntimeModelCatalogProvider | null {
  return catalog.providers.find((provider) => provider.providerID === providerID) ?? null;
}

function buildProviderSelectionKeyboard(
  catalog: RuntimeModelCatalog,
  currentModel: ModelInfo,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  catalog.providers.forEach((provider) => {
    const isActiveProvider = provider.providerID === currentModel.providerID;
    const label = `${isActiveProvider ? "✅ " : ""}${provider.providerID} (${provider.models.length})`;
    keyboard.text(label, buildProviderCallback(provider.providerID)).row();
  });

  return keyboard;
}

function buildProviderSelectionText(currentModel: ModelInfo): string {
  return t("model.menu.providers_title", {
    name: getCurrentModelDisplay(currentModel),
  });
}

function normalizePage(requestedPage: number, itemCount: number): { page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(itemCount / MODELS_PER_PAGE));
  return {
    page: Math.min(requestedPage, totalPages - 1),
    totalPages,
  };
}

function buildProviderModelsKeyboard(
  provider: RuntimeModelCatalogProvider,
  currentModel: ModelInfo,
  requestedPage: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (provider.models.length === 0) {
    keyboard.text(t("model.menu.button.back_providers"), MODEL_BACK_CALLBACK).row();
    return appendInlineMenuCancelButton(keyboard, "model");
  }

  const { page, totalPages } = normalizePage(requestedPage, provider.models.length);
  const pageStart = page * MODELS_PER_PAGE;
  const pageModels = provider.models.slice(pageStart, pageStart + MODELS_PER_PAGE);

  pageModels.forEach((model) => {
    const isActive =
      currentModel.providerID === model.providerID && currentModel.modelID === model.modelID;
    const label = isActive
      ? `✅ ${formatModelForButton(model.providerID, model.modelID)}`
      : formatModelForButton(model.providerID, model.modelID);
    keyboard
      .text(
        label,
        `${MODEL_CALLBACK_PREFIX}${encodeCallbackToken(model.providerID)}:${encodeCallbackToken(model.modelID)}`,
      )
      .row();
  });

  if (page > 0) {
    keyboard.text(t("model.menu.button.prev_page"), buildProviderPageCallback(provider.providerID, page - 1));
  }

  if (page < totalPages - 1) {
    keyboard.text(t("model.menu.button.next_page"), buildProviderPageCallback(provider.providerID, page + 1));
  }

  if (page > 0 || page < totalPages - 1) {
    keyboard.row();
  }

  keyboard.text(t("model.menu.button.back_providers"), MODEL_BACK_CALLBACK).row();

  return appendInlineMenuCancelButton(keyboard, "model");
}

function buildProviderModelsText(
  provider: RuntimeModelCatalogProvider,
  currentModel: ModelInfo,
  requestedPage: number,
): string {
  const currentModelName = getCurrentModelDisplay(currentModel);

  if (provider.models.length === 0) {
    return t("model.menu.provider_empty", {
      name: currentModelName,
      provider: provider.providerID,
    });
  }

  const { page, totalPages } = normalizePage(requestedPage, provider.models.length);

  return t("model.menu.provider_title", {
    name: currentModelName,
    provider: provider.providerID,
    current: page + 1,
    total: totalPages,
  });
}

async function renderProviderSelection(
  ctx: Context,
  currentModel: ModelInfo,
  catalog: RuntimeModelCatalog,
): Promise<void> {
  const keyboard = buildProviderSelectionKeyboard(catalog, currentModel);
  appendInlineMenuCancelButton(keyboard, "model");
  await ctx.editMessageText(buildProviderSelectionText(currentModel), {
    reply_markup: keyboard,
  });
}

async function renderProviderModels(
  ctx: Context,
  provider: RuntimeModelCatalogProvider,
  currentModel: ModelInfo,
  requestedPage: number,
): Promise<void> {
  await ctx.editMessageText(buildProviderModelsText(provider, currentModel, requestedPage), {
    reply_markup: buildProviderModelsKeyboard(provider, currentModel, requestedPage),
  });
}

export async function handleModelSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !isModelMenuCallback(callbackQuery.data)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "model");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[ModelHandler] Received callback: ${callbackQuery.data}`);

  try {
    if (callbackQuery.data === MODEL_BACK_CALLBACK) {
      const currentModel = fetchCurrentModel();
      const catalog = await getRuntimeModelCatalog();
      await renderProviderSelection(ctx, currentModel, catalog);
      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }

    const providerPage = parseProviderPageCallback(callbackQuery.data);
    const providerID = providerPage?.providerID ?? parseProviderCallback(callbackQuery.data);

    if (providerID) {
      const currentModel = fetchCurrentModel();
      const catalog = await getRuntimeModelCatalog();
      const provider = findProvider(catalog, providerID);

      if (!provider) {
        await ctx
          .answerCallbackQuery({
            text: t("model.menu.provider_stale_callback"),
            show_alert: true,
          })
          .catch(() => {});
        return true;
      }

      await renderProviderModels(ctx, provider, currentModel, providerPage?.page ?? 0);
      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }

    const parsedModel = parseModelCallback(callbackQuery.data);
    if (!parsedModel) {
      logger.error(`[ModelHandler] Invalid callback data format: ${callbackQuery.data}`);
      clearActiveInlineMenu("model_select_invalid_callback");
      await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
      return true;
    }

    const catalog = await getRuntimeModelCatalog();
    const provider = findProvider(catalog, parsedModel.providerID);
    const modelExists = provider?.models.some((model) => model.modelID === parsedModel.modelID) ?? false;

    if (!provider || !modelExists) {
      await ctx
        .answerCallbackQuery({
          text: t("model.menu.model_stale_callback"),
          show_alert: true,
        })
        .catch(() => {});
      return true;
    }

    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    const modelInfo: ModelInfo = {
      providerID: parsedModel.providerID,
      modelID: parsedModel.modelID,
      variant: "default",
    };

    selectModel(modelInfo);
    threadContextManager.bindModelToActiveContext(modelInfo);
    keyboardManager.updateModel(modelInfo);
    await pinnedMessageManager.refreshContextLimit();

    const currentAgent = getStoredAgent();
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
      currentAgent,
      modelInfo,
      contextInfo ?? undefined,
      variantName,
    );
    const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

    clearActiveInlineMenu("model_selected");

    await ctx.answerCallbackQuery({ text: t("model.changed_callback", { name: displayName }) });
    await ctx.reply(
      t("model.changed_message", { name: displayName }),
      withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
    );
    await ctx.deleteMessage().catch(() => {});

    return true;
  } catch (err) {
    clearActiveInlineMenu("model_select_error");
    logger.error("[ModelHandler] Error handling model select:", err);
    await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
    return false;
  }
}

export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const catalog = await getRuntimeModelCatalog();
    const keyboard = buildProviderSelectionKeyboard(catalog, currentModel);

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("model.menu.empty"));
      return;
    }

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text: buildProviderSelectionText(currentModel),
      keyboard,
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}
