import { Context } from "grammy";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { clearSession } from "../../session/manager.js";
import { clearProject, getUserDeployTarget, getUserLocale } from "../../settings/manager.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { abortCurrentOperation } from "./abort.js";
import { t } from "../../i18n/index.js";
import { threadContextManager } from "../../thread/manager.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { getCurrentTelegramConversationScope } from "../../telegram/scope.js";
import { showWebPanelOnboarding } from "../../server/start-flow.js";
import { showLanguageSelection } from "../handlers/onboarding-flow.js";

export async function startCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  // New unauthorized user — show onboarding (language → config) before access request
  if (userId) {
    const locale = getUserLocale();
    const deployTarget = getUserDeployTarget(userId);
    if (!locale || !deployTarget) {
      await showLanguageSelection(ctx);
      return;
    }
  }

  if (ctx.chat) {
    if (!pinnedMessageManager.isInitialized()) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat.id);
    }
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  await abortCurrentOperation(ctx, { notifyUser: false });
  foregroundSessionState.clearAll("start_command_reset", getCurrentTelegramConversationScope());

  clearSession();
  clearProject();
  threadContextManager.clearActiveContext("start_command_reset");
  keyboardManager.clearContext();
  await pinnedMessageManager.clear();

  if (pinnedMessageManager.getContextLimit() === 0) {
    await pinnedMessageManager.refreshContextLimit();
  }

  // Get current agent, model, and context
  const currentAgent = getStoredAgent();
  const currentModel = getStoredModel();
  const variantName = formatVariantForButton(currentModel.variant || "default");
  const contextInfo =
    pinnedMessageManager.getContextInfo() ??
    (pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
      : null);

  keyboardManager.updateAgent(currentAgent);
  keyboardManager.updateModel(currentModel);
  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  const keyboard = createMainKeyboard(
    currentAgent,
    currentModel,
    contextInfo ?? undefined,
    variantName,
    { isTerminalTopic: false },
  );

  await ctx.reply(
    t("start.welcome"),
    withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
  );

  await showWebPanelOnboarding(ctx);
}
