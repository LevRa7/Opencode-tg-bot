import { Keyboard } from "grammy";
import { getAgentEmoji } from "../../agent/types.js";
import { formatModelForButton } from "../../model/types.js";
import type { ModelInfo } from "../../model/types.js";
import type { ContextInfo } from "../../keyboard/types.js";
import { t } from "../../i18n/index.js";

/**
 * Format token count for display (e.g., 150000 -> "150K", 1500000 -> "1.5M")
 */
function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${Math.round(count / 1000)}K`;
  }
  return count.toString();
}

/**
 * Format context information for button
 */
function formatContextForButton(contextInfo: ContextInfo): string {
  const used = formatTokenCount(contextInfo.tokensUsed);
  const limit = formatTokenCount(contextInfo.tokensLimit);
  const percent = Math.round((contextInfo.tokensUsed / contextInfo.tokensLimit) * 100);
  return t("keyboard.context", { used, limit, percent });
}

/**
 * Create Reply Keyboard with model and agent mode/context indicators.
 * @param currentAgent Current agent name (e.g., "build", "plan")
 * @param currentModel Current model info
 * @param contextInfo Optional context information (tokens used/limit)
 * @param _variantName Ignored; variant is read from currentModel.variant.
 * @returns Reply Keyboard with model and agent+context in one row.
 */
export function createMainKeyboard(
  currentAgent: string,
  currentModel: ModelInfo,
  contextInfo?: ContextInfo,
  _variantName?: string,
): Keyboard {
  const keyboard = new Keyboard();
  const agentEmoji = getAgentEmoji(currentAgent);

  const contextText = contextInfo
    ? formatContextForButton(contextInfo)
    : t("keyboard.context_empty");
  const contextWithoutEmoji = contextText.replace(/^📊\s*/, "");

  let modelText = formatModelForButton(currentModel.providerID, currentModel.modelID);

  const variant = currentModel.variant;
  if (variant && variant !== "default" && variant !== "none") {
    const shortVariant = variant.length > 10 ? `${variant.substring(0, 7)}...` : variant;
    modelText = `${modelText} (${shortVariant})`;
  }

  keyboard.text(modelText).text(`${agentEmoji} ${contextWithoutEmoji}`).row();

  return keyboard.resized();
}

/**
 * Create Reply Keyboard with agent mode indicator
 * @param currentAgent Current agent name (e.g., "build", "plan")
 * @returns Reply Keyboard with single button showing current mode
 * @deprecated Use createMainKeyboard instead
 */
export function createAgentKeyboard(currentAgent: string): Keyboard {
  const keyboard = new Keyboard();
  const emoji = getAgentEmoji(currentAgent);

  keyboard.text(emoji).row();

  return keyboard.resized();
}

/**
 * Remove Reply Keyboard (for cleanup)
 */
export function removeKeyboard(): { remove_keyboard: true } {
  return { remove_keyboard: true };
}
