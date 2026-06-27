import { Context, InlineKeyboard } from "grammy";
import { selectAgent, getAvailableAgents, fetchCurrentAgent } from "../../agent/manager.js";
import { getAgentDisplayName, getAgentEmoji } from "../../agent/types.js";
import { getStoredModel } from "../../model/manager.js";
import { logger } from "../../utils/logger.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import {
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { t } from "../../i18n/index.js";
import type { I18nKey } from "../../i18n/en.js";
import { threadContextManager } from "../../thread/manager.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";

/**
 * Handle agent selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
export async function handleAgentSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("agent:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "agent");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[AgentHandler] Received callback: ${callbackQuery.data}`);

  try {
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    if (pinnedMessageManager.getContextLimit() === 0) {
      await pinnedMessageManager.refreshContextLimit();
    }

    const agentName = callbackQuery.data.replace("agent:", "");

    selectAgent(agentName);
    threadContextManager.bindAgentToActiveContext(agentName);

    keyboardManager.updateAgent(agentName);

    const currentModel = getStoredModel();
    const contextInfo =
      pinnedMessageManager.getContextInfo() ??
      (pinnedMessageManager.getContextLimit() > 0
        ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
        : null);

    keyboardManager.updateModel(currentModel);
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }

    const keyboard = createMainKeyboard(agentName, currentModel, contextInfo ?? undefined, undefined, {
      isTerminalTopic: false,
    });
    const displayName = getAgentDisplayName(agentName);

    clearActiveInlineMenu("agent_selected");

    await ctx.answerCallbackQuery({ text: t("agent.changed_callback", { name: displayName }) });
    await ctx.reply(
      t("agent.changed_message", { name: displayName }),
      withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
    );

    await ctx.deleteMessage().catch(() => {});

    return true;
  } catch (err) {
    clearActiveInlineMenu("agent_select_error");
    logger.error("[AgentHandler] Error handling agent select:", err);
    await ctx.answerCallbackQuery({ text: t("agent.change_error_callback") }).catch(() => {});
    return false;
  }
}

/**
 * Build inline keyboard with available agents
 * @param currentAgent Current agent name for highlighting
 * @returns InlineKeyboard with agent selection buttons
 */
export async function buildAgentSelectionMenu(currentAgent?: string): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const agents = await getAvailableAgents();

  if (agents.length === 0) {
    logger.warn("[AgentHandler] No available agents found");
    return keyboard;
  }

  // Add button for each agent
  agents.forEach((agent) => {
    const emoji = getAgentEmoji(agent.name);
    const isActive = agent.name === currentAgent;
    const label = isActive
      ? `✅ ${emoji} ${agent.name.toUpperCase()}`
      : `${emoji} ${agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}`;

    keyboard.text(label, `agent:${agent.name}`).row();
  });

  return keyboard;
}

/**
 * Show agent selection menu
 * @param ctx grammY context
 */
export async function showAgentSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentAgent = await fetchCurrentAgent();
    const keyboard = await buildAgentSelectionMenu(currentAgent);

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("agent.menu.empty"));
      return;
    }

    const text = currentAgent
      ? t("agent.menu.current", { name: getAgentDisplayName(currentAgent) })
      : t("agent.menu.select");

    await replyWithInlineMenu(ctx, {
      menuKind: "agent",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[AgentHandler] Error showing agent menu:", err);
    await ctx.reply(t("agent.menu.error"));
  }
}

function getAgentModeDescription(agentName: string, fallback?: string): string {
  if (fallback?.trim()) {
    return fallback.trim();
  }

  const knownModes = new Set(["plan", "build", "general", "explore", "title", "summary", "compaction"]);
  if (!knownModes.has(agentName)) {
    return t("agent.mode.custom");
  }

  const key = `agent.mode.${agentName}` as I18nKey;
  return t(key);
}

export async function cycleAgentMode(ctx: Context): Promise<void> {
  try {
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    if (pinnedMessageManager.getContextLimit() === 0) {
      await pinnedMessageManager.refreshContextLimit();
    }

    const currentAgent = await fetchCurrentAgent();
    const agents = await getAvailableAgents();

    if (agents.length === 0) {
      logger.warn("[AgentHandler] No available agents for cycling");
      return;
    }

    const currentIndex = agents.findIndex((agent) => agent.name === currentAgent);
    const nextIndex = (currentIndex + 1) % agents.length;
    const nextAgentInfo = agents[nextIndex];
    const nextAgent = nextAgentInfo.name;

    selectAgent(nextAgent);
    threadContextManager.bindAgentToActiveContext(nextAgent);
    keyboardManager.updateAgent(nextAgent);

    const currentModel = getStoredModel();
    const contextInfo =
      pinnedMessageManager.getContextInfo() ??
      (pinnedMessageManager.getContextLimit() > 0
        ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
        : null);

    keyboardManager.updateModel(currentModel);
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }

    const keyboard = createMainKeyboard(nextAgent, currentModel, contextInfo ?? undefined, undefined, {
      isTerminalTopic: false,
    });
    const displayName = getAgentDisplayName(nextAgent);
    const description = getAgentModeDescription(nextAgent, nextAgentInfo.description);

    await ctx.reply(
      t("agent.cycled", { name: displayName, description }),
      withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
    );

    logger.info(`[AgentHandler] Agent cycled to: ${nextAgent}`);
  } catch (err) {
    logger.error("[AgentHandler] Error cycling agent mode:", err);
    await ctx.reply(t("agent.menu.error"));
  }
}
