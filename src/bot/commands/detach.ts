import { CommandContext, Context } from "grammy";
import { getCurrentProject, clearSession, getCurrentSession } from "../../settings/manager.js";
import { stopEventListening } from "../../opencode/events.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { assistantRunState } from "../assistant-run-state.js";
import { resolveScopedSessionFromContext } from "../runtime/scope-session-resolver.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { getCurrentTelegramConversationScopeKey } from "../../telegram/scope.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export async function detachCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("detach.project_not_selected"));
      return;
    }

    const resolved = resolveScopedSessionFromContext(ctx);
    if (!resolved) {
      await ctx.reply(t("detach.no_active_session"));
      return;
    }

    const { session: currentSession, scope: currentScope } = resolved;

    stopEventListening();
    clearScopedSessionRuntime(currentSession.id, "detach_command", { scope: currentScope });
    clearPromptResponseMode(currentSession.id);
    foregroundSessionState.markIdle(currentSession.id, currentScope);
    assistantRunState.clearRun(currentSession.id, "detach_command");
    clearAllInteractionState("detach_command", getCurrentTelegramConversationScopeKey());
    clearSession();

    if (pinnedMessageManager.isInitialized()) {
      try {
        await pinnedMessageManager.clear();
      } catch (error) {
        logger.error("[Detach] Failed to clear pinned message:", error);
      }
    }

    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    await pinnedMessageManager.refreshContextLimit();
    const contextLimit = pinnedMessageManager.getContextLimit();
    keyboardManager.updateContext(0, contextLimit);

    const keyboard = keyboardManager.getKeyboard();

    logger.info(
      `[Detach] Detached from session: id=${currentSession.id}, title="${currentSession.title}", project=${currentProject.worktree}`,
    );

    const messageThreadId = extractMessageThreadIdFromContext(ctx);
    await ctx.reply(
      t("detach.success", { title: currentSession.title }),
      withMessageThreadId(keyboard ? { reply_markup: keyboard } : {}, messageThreadId),
    );
  } catch (error) {
    logger.error("[Detach] Failed to detach from current session:", error);
    await ctx.reply(t("detach.error"));
  }
}
