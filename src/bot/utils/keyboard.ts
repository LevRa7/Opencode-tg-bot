import { Keyboard } from "grammy";
import { getAgentEmoji } from "../../agent/types.js";
import { formatModelForButton } from "../../model/types.js";
import type { ModelInfo } from "../../model/types.js";
import type { ContextInfo } from "../../keyboard/types.js";
import type { CpuInfo, RamInfo } from "../../utils/system-info.js";
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

function formatSystemInfoButton(cpu: CpuInfo, ram: RamInfo): string {
  return t("keyboard.system_info", {
    cpuPercent: cpu.usagePercent,
    cpuModel: cpu.model,
    ramUsed: ram.usedGB,
    ramTotal: ram.totalGB,
    ramPercent: ram.percentUsed,
  });
}

export interface KeyboardOptions {
  isRunning?: boolean;
  cpuInfo?: CpuInfo;
  ramInfo?: RamInfo;
  isTerminalTopic?: boolean;
}

/**
 * Create Reply Keyboard. Terminal topics show terminal buttons
 * (new window, stop, system info). Non-terminal topics show
 * model and context buttons.
 */
export function createMainKeyboard(
  currentAgent: string,
  currentModel: ModelInfo,
  contextInfo?: ContextInfo,
  _variantName?: string,
  options?: KeyboardOptions,
): Keyboard {
  const keyboard = new Keyboard();

  if (options?.isTerminalTopic !== false) {
    // Terminal topic: only terminal buttons

    // Row 1: New Window + Stop in one row
    if (options?.isRunning) {
      keyboard.text(t("keyboard.new_window")).text(t("keyboard.stop")).row();
    } else {
      keyboard.text(t("keyboard.new_window")).row();
    }

    // Row 2: System info (CPU + RAM) – one button, two lines
    if (options?.cpuInfo && options?.ramInfo) {
      keyboard.text(formatSystemInfoButton(options.cpuInfo, options.ramInfo)).row();
    }

    return keyboard.resized();
  }

  // Non-terminal topic: model + context buttons
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
