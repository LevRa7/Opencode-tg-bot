import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, getCurrentSession, SessionInfo } from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import { getCurrentProject, setConversationCurrentProject } from "../../settings/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { threadContextManager } from "../../thread/manager.js";
import { getDefaultProject } from "../../project/manager.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { attachSessionForScope } from "../../attach/service.js";
import { showPermissionRequest } from "../handlers/permission.js";
import { showCurrentQuestion } from "../handlers/question.js";

export async function newCommand(ctx: CommandContext<Context>) {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    let currentProject = getCurrentProject();

    if (!currentProject) {
      const defaultProject = await getDefaultProject();
      if (!defaultProject) {
        await ctx.reply(t("new.project_not_selected"));
        return;
      }

      currentProject = defaultProject;
    }

    setConversationCurrentProject(currentProject);
    threadContextManager.bindProjectToActiveContext(currentProject);

    logger.debug("[Bot] Creating new session for directory:", currentProject.worktree);

    const { data: session, error } = await opencodeClient.session.create({
      directory: currentProject.worktree,
    });

    if (error || !session) {
      throw error || new Error("No data received from server");
    }

    logger.info(
      `[Bot] Created new session via /new command: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
    );

    const sessionInfo: SessionInfo = {
      id: session.id,
      title: session.title,
      directory: currentProject.worktree,
    };
    const previousSession = getCurrentSession();
    if (previousSession) {
      clearScopedSessionRuntime(previousSession.id, "session_created");
    }

    setCurrentSession(sessionInfo);
    const activeScope = threadContextManager.getActiveScope();
    if (activeScope) {
      await attachSessionForScope({
        scope: activeScope,
        session: sessionInfo,
        reason: "new_session",
        restoreQuestion: () =>
          showCurrentQuestion(ctx.api, activeScope.chatId, activeScope.messageThreadId),
        restorePermission: (request) =>
          showPermissionRequest(
            ctx.api,
            activeScope.chatId,
            request,
            activeScope.messageThreadId,
          ),
      });
    }
    clearAllInteractionState("session_created");
    await ingestSessionInfoForCache(session);

    // Initialize pinned message manager and create pinned message
    if (!pinnedMessageManager.isInitialized()) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat.id);
    }

    // Initialize keyboard manager if not already
    keyboardManager.initialize(ctx.api, ctx.chat.id);

    try {
      await pinnedMessageManager.onSessionChange(session.id, session.title);
    } catch (err) {
      logger.error("[Bot] Error creating pinned message:", err);
    }

    // Get current state for keyboard
    const currentAgent = getStoredAgent();
    const currentModel = getStoredModel();
    const contextInfo = pinnedMessageManager.getContextInfo();
    const variantName = formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(
      currentAgent,
      currentModel,
      contextInfo ?? undefined,
      variantName,
    );

    await ctx.reply(
      t("new.created", { title: session.title }),
      withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
    );
  } catch (error) {
    logger.error("[Bot] Error creating session:", error);
    await ctx.reply(t("new.create_error"));
  }
}
