import { Context, InlineKeyboard } from "grammy";
import {
  getAvailableVariants,
  getCurrentVariant,
  setCurrentVariant,
  formatVariantForDisplay,
} from "../../variant/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { logger } from "../../utils/logger.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { t } from "../../i18n/index.js";
import type { I18nKey } from "../../i18n/en.js";
import { threadContextManager } from "../../thread/manager.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import {
  extractTelegramConversationScopeFromContext,
  runWithTelegramConversationScope,
} from "../../telegram/scope.js";

type ApplySelectedVariantResult =
  | { applied: true; displayName: string }
  | { applied: false; reason: "model_required" | "not_found"; variantId: string };

export async function applySelectedVariant(
  ctx: Context,
  variantId: string,
  options: { replyTextKey: I18nKey },
): Promise<ApplySelectedVariantResult> {
  const currentModel = getStoredModel();

  if (!currentModel.providerID || !currentModel.modelID) {
    return { applied: false, reason: "model_required", variantId };
  }

  const variants = await getAvailableVariants(currentModel.providerID, currentModel.modelID);
  const requestedVariant = variants.find(
    (variant) => variant.id === variantId && !variant.disabled,
  );

  if (!requestedVariant) {
    return { applied: false, reason: "not_found", variantId };
  }

  if (ctx.chat) {
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  if (pinnedMessageManager.getContextLimit() === 0) {
    await pinnedMessageManager.refreshContextLimit();
  }

  setCurrentVariant(variantId);

  const updatedModel = getStoredModel();
  threadContextManager.bindModelToActiveContext(updatedModel);
  keyboardManager.updateModel(updatedModel);
  keyboardManager.updateVariant(variantId);

  const contextInfo =
    pinnedMessageManager.getContextInfo() ??
    (pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
      : null);

  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  // Force an immediate refresh of the scope-keyed host keyboard so the model label and
  // token counter reflect the new variant right away instead of waiting for the auto tick.
  // The forced update is wrapped in the ctx's conversation scope because the keyboard host
  // (pinned message) is scope-keyed; grammY handlers must target the same scope explicitly.
  if (ctx.chat) {
    const scope = extractTelegramConversationScopeFromContext(ctx);
    await runWithTelegramConversationScope(scope, () =>
      keyboardManager.sendKeyboardUpdate(ctx.chat!.id, undefined, { force: true }),
    ).catch(() => {});
  }

  const keyboard = keyboardManager.getKeyboard();
  const displayName = formatVariantForDisplay(variantId);

  await ctx.reply(
    t(options.replyTextKey, { name: displayName }),
    withMessageThreadId(keyboard ? { reply_markup: keyboard } : undefined, extractMessageThreadIdFromContext(ctx)),
  );

  return { applied: true, displayName };
}

/**
 * Handle variant selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
export async function handleVariantSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("variant:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "variant");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[VariantHandler] Received callback: ${callbackQuery.data}`);

  try {
    // Parse callback data: "variant:variantId"
    const variantId = callbackQuery.data.replace("variant:", "");

    const result = await applySelectedVariant(ctx, variantId, {
      replyTextKey: "variant.changed_message",
    });

    if (!result.applied) {
      if (result.reason === "model_required") {
        logger.error("[VariantHandler] No model selected");
        await ctx.answerCallbackQuery({ text: t("variant.model_not_selected_callback") });
        return false;
      }

      await ctx.answerCallbackQuery({
        text: t("variant.command.not_found", { name: result.variantId }),
      });
      return true;
    }

    clearActiveInlineMenu("variant_selected");

    await ctx.answerCallbackQuery({
      text: t("variant.changed_callback", { name: result.displayName }),
    });

    // Re-render the menu in place with the checkmark moved to the newly selected variant,
    // instead of deleting it, so the user keeps visual context of what is now active.
    const currentModel = getStoredModel();
    const rebuiltMenu = await buildVariantSelectionMenu(
      variantId,
      currentModel.providerID,
      currentModel.modelID,
    );
    appendInlineMenuCancelButton(rebuiltMenu, "variant");
    await ctx.editMessageReplyMarkup({ reply_markup: rebuiltMenu }).catch(() => {});

    return true;
  } catch (err) {
    clearActiveInlineMenu("variant_select_error");
    logger.error("[VariantHandler] Error handling variant select:", err);
    await ctx.answerCallbackQuery({ text: t("variant.change_error_callback") }).catch(() => {});
    return false;
  }
}

/**
 * Build inline keyboard with available variants
 * @param currentVariant Current variant for highlighting
 * @param providerID Provider ID
 * @param modelID Model ID
 * @returns InlineKeyboard with variant selection buttons
 */
export async function buildVariantSelectionMenu(
  currentVariant: string,
  providerID: string,
  modelID: string,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const variants = await getAvailableVariants(providerID, modelID);

  if (variants.length === 0) {
    logger.warn("[VariantHandler] No variants found");
    return keyboard;
  }

  // Filter only active variants (not disabled)
  const activeVariants = variants.filter((v) => !v.disabled);

  if (activeVariants.length === 0) {
    logger.warn("[VariantHandler] No active variants found");
    // If no active variants, show default at least
    keyboard.text(`✅ ${formatVariantForDisplay("default")}`, "variant:default").row();
    return keyboard;
  }

  // Add button for each variant (one per row)
  activeVariants.forEach((variant) => {
    const isActive = variant.id === currentVariant;
    const label = formatVariantForDisplay(variant.id);
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, `variant:${variant.id}`).row();
  });

  return keyboard;
}

/**
 * Show variant selection menu
 * @param ctx grammY context
 */
export async function showVariantSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = getStoredModel();

    if (!currentModel.providerID || !currentModel.modelID) {
      await ctx.reply(t("variant.select_model_first"));
      return;
    }

    const currentVariant = getCurrentVariant();
    const keyboard = await buildVariantSelectionMenu(
      currentVariant,
      currentModel.providerID,
      currentModel.modelID,
    );

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("variant.menu.empty"));
      return;
    }

    const displayName = formatVariantForDisplay(currentVariant);
    const text = t("variant.menu.current", { name: displayName });

    await replyWithInlineMenu(ctx, {
      menuKind: "variant",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[VariantHandler] Error showing variant menu:", err);
    await ctx.reply(t("variant.menu.error"));
  }
}
