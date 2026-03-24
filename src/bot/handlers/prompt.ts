import { Bot, Context } from "grammy";
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { clearSession, getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import { getCurrentProject, setCurrentProject } from "../../settings/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { resolvePromptModelForMedia } from "../../model/media-fallback.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { sendMessageWithoutDraftEffect } from "../utils/send-message-draft-effect-context.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { stopEventListening } from "../../opencode/events.js";
import { interactionManager } from "../../interaction/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { formatErrorDetails } from "../../utils/error-format.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { threadContextManager } from "../../thread/manager.js";
import { ensureUserProjectForCommand } from "../../project/user-project.js";

/** Module-level references for async callbacks that don't have ctx. */
let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;

export function getPromptBotInstance(): Bot<Context> | null {
  return botInstance;
}

export function getPromptChatId(): number | null {
  return chatIdInstance;
}

function formatSessionSelectionHint(): string {
  return `${t("status.session_not_selected")}\n${t("status.session_hint")}`;
}

async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });

    if (error || !data) {
      logger.warn("[Bot] Failed to check session status before prompt:", error);
      return false;
    }

    const sessionStatus = (data as Record<string, { type?: string }>)[sessionId];
    if (!sessionStatus) {
      return false;
    }

    logger.debug(`[Bot] Current session status before prompt: ${sessionStatus.type || "unknown"}`);
    return sessionStatus.type === "busy";
  } catch (err) {
    logger.warn("[Bot] Error checking session status before prompt:", err);
    return false;
  }
}

async function resetMismatchedSessionContext(): Promise<void> {
  stopEventListening();
  summaryAggregator.clear();
  foregroundSessionState.clearAll("session_mismatch_reset");
  clearAllInteractionState("session_mismatch_reset");
  clearSession();
  keyboardManager.clearContext();

  if (!pinnedMessageManager.isInitialized()) {
    return;
  }

  try {
    await pinnedMessageManager.clear();
  } catch (err) {
    logger.error("[Bot] Failed to clear pinned message during session reset:", err);
  }
}

export interface ProcessPromptDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

/**
 * Processes a user prompt: ensures project/session, subscribes to events, and sends
 * the prompt to OpenCode. Used by text, voice, and photo message handlers.
 *
 * @param ctx - Grammy context
 * @param text - Text content of the prompt
 * @param deps - Dependencies (bot and event subscription)
 * @param fileParts - Optional file parts (for photo/document attachments)
 * @returns true if the prompt was dispatched, false if it was blocked/failed early.
 */
export async function processUserPrompt(
  ctx: Context,
  text: string,
  deps: ProcessPromptDeps,
  fileParts: FilePartInput[] = [],
): Promise<boolean> {
  const { bot, ensureEventSubscription } = deps;
  const messageThreadId = extractMessageThreadIdFromContext(ctx);
  const activeScope = threadContextManager.getActiveScope();

  let currentProject = getCurrentProject();
  if (!currentProject) {
    if (!threadContextManager.canAutoAssignProjectForActiveContext()) {
      await ctx.reply(t("bot.project_not_selected"));
      return false;
    }

    const tgId = ctx.from?.id;
    if (!tgId) {
      await ctx.reply(t("bot.project_not_selected"));
      return false;
    }

    logger.info(`[Bot] No project selected, auto-creating project for tgId=${tgId}`);
    currentProject = await ensureUserProjectForCommand(tgId);
    setCurrentProject(currentProject);
  }

  threadContextManager.bindProjectToActiveContext(currentProject);

  botInstance = bot;
  chatIdInstance = ctx.chat!.id;

  // Initialize pinned message manager if not already
  if (!pinnedMessageManager.isInitialized()) {
    pinnedMessageManager.initialize(bot.api, ctx.chat!.id);
  }

  // Initialize keyboard manager if not already
  keyboardManager.initialize(bot.api, ctx.chat!.id);

  let currentSession = getCurrentSession();

  if (currentSession && currentSession.directory !== currentProject.worktree) {
    logger.warn(
      `[Bot] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${currentProject.worktree}. Resetting session context.`,
    );
    await resetMismatchedSessionContext();
    threadContextManager.clearSessionForActiveContext();
    await ctx.reply(t("bot.session_reset_project_mismatch"));
    return false;
  }

  if (!currentSession) {
    if (!threadContextManager.canAutoAssignSessionForActiveContext()) {
      await ctx.reply(formatSessionSelectionHint());
      return false;
    }

    await ctx.reply(t("bot.creating_session"));

    const { data: session, error } = await opencodeClient.session.create({
      directory: currentProject.worktree,
    });

    if (error || !session) {
      await ctx.reply(t("bot.create_session_error"));
      return false;
    }

    logger.info(
      `[Bot] Created new session: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
    );

    currentSession = {
      id: session.id,
      title: session.title,
      directory: currentProject.worktree,
    };

    setCurrentSession(currentSession);
    threadContextManager.bindSessionToActiveContext(currentSession);
    await ingestSessionInfoForCache(session);

    // Create pinned message for new session
    try {
      await pinnedMessageManager.onSessionChange(session.id, session.title);
    } catch (err) {
      logger.error("[Bot] Error creating pinned message for new session:", err);
    }

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

    await ctx.reply(t("bot.session_created", { title: session.title }), {
      reply_markup: keyboard,
    });
  } else {
    logger.info(
      `[Bot] Using existing session: id=${currentSession.id}, title="${currentSession.title}"`,
    );

    // Ensure pinned message exists for existing session
    if (!pinnedMessageManager.getState().messageId) {
      try {
        await pinnedMessageManager.onSessionChange(currentSession.id, currentSession.title);
      } catch (err) {
        logger.error("[Bot] Error creating pinned message for existing session:", err);
      }
    }

    threadContextManager.bindSessionToActiveContext(currentSession);
  }

  await ensureEventSubscription(currentSession.directory);

  summaryAggregator.setSession(currentSession.id);
  summaryAggregator.setBotAndChatId(bot, ctx.chat!.id, messageThreadId);

  const sessionIsBusy = await isSessionBusy(currentSession.id, currentSession.directory);
  if (sessionIsBusy) {
    logger.info(`[Bot] Ignoring new prompt: session ${currentSession.id} is busy`);
    await ctx.reply(t("bot.session_busy"));
    return false;
  }

  try {
    const currentAgent = getStoredAgent();
    const storedModel = getStoredModel();
    const resolvedModel = await resolvePromptModelForMedia({ storedModel, fileParts });

    if (resolvedModel.missingMediaSupport) {
      await ctx.reply(t("bot.media_model_no_support"));
      return false;
    }

    // Build parts array with text and files
    const parts: Array<TextPartInput | FilePartInput> = [];

    // Add text part if present
    if (text.trim().length > 0) {
      parts.push({ type: "text", text });
    }

    // Add file parts
    parts.push(...fileParts);

    // If no text and files exist, use a placeholder
    if (parts.length === 0 || (parts.length > 0 && parts.every((p) => p.type === "file"))) {
      if (fileParts.length > 0) {
        // Files without text - add a minimal system prompt
        parts.unshift({ type: "text", text: "See attached file" });
      }
    }

    const promptOptions: {
      sessionID: string;
      directory: string;
      parts: Array<TextPartInput | FilePartInput>;
      model?: { providerID: string; modelID: string };
      agent?: string;
      variant?: string;
    } = {
      sessionID: currentSession.id,
      directory: currentSession.directory,
      parts,
      agent: currentAgent,
    };

    // Use stored model or media fallback model when needed.
    if (resolvedModel.model) {
      promptOptions.model = {
        providerID: resolvedModel.model.providerID,
        modelID: resolvedModel.model.modelID,
      };

      if (resolvedModel.variant) {
        promptOptions.variant = resolvedModel.variant;
      }
    }

    if (resolvedModel.fallbackUsed) {
      logger.info(
        `[Bot] Using media fallback model ${resolvedModel.model?.providerID}/${resolvedModel.model?.modelID}`,
      );
    }

    const promptErrorLogContext = {
      sessionId: currentSession.id,
      directory: currentSession.directory,
      agent: currentAgent || "default",
      modelProvider: resolvedModel.model?.providerID || storedModel.providerID || "default",
      modelId: resolvedModel.model?.modelID || storedModel.modelID || "default",
      variant: resolvedModel.variant || "default",
      promptLength: text.length,
      fileCount: fileParts.length,
    };

    logger.info(
      `[Bot] Calling session.prompt (fire-and-forget) with agent=${currentAgent}, fileCount=${fileParts.length}...`,
    );

    const reservedForegroundSlot = foregroundSessionState.tryMarkBusy(
      currentSession.id,
      activeScope,
    );
    if (!reservedForegroundSlot) {
      await ctx.reply(
        t("bot.parallel_limit_reached", {
          limit: "5",
        }),
      );
      return false;
    }

    // CRITICAL: DO NOT wait for session.prompt to complete.
    // If we wait, the handler will not finish and grammY will not call getUpdates,
    // which blocks receiving button callback_query updates.
    // The processing result will arrive via SSE events.
    safeBackgroundTask({
      taskName: "session.prompt",
      task: () => opencodeClient.session.prompt(promptOptions),
      onSuccess: ({ error }) => {
        if (error) {
          foregroundSessionState.markIdle(currentSession.id, activeScope);
          const details = formatErrorDetails(error, 6000);
          logger.error(
            "[Bot] OpenCode API returned an error for session.prompt",
            promptErrorLogContext,
          );
          logger.error("[Bot] session.prompt error details:", details);
          logger.error("[Bot] session.prompt raw API error object:", error);

          // Send user-friendly error via API directly because ctx is no longer available
          void sendMessageWithoutDraftEffect(
            bot.api,
            ctx.chat!.id,
            t("bot.prompt_send_error"),
            withMessageThreadId(undefined, messageThreadId),
          ).catch(() => {});
          return;
        }

        logger.info("[Bot] session.prompt completed");
      },
      onError: (error) => {
        foregroundSessionState.markIdle(currentSession.id, activeScope);
        const details = formatErrorDetails(error, 6000);
        logger.error("[Bot] session.prompt background task failed", promptErrorLogContext);
        logger.error("[Bot] session.prompt background failure details:", details);
        logger.error("[Bot] session.prompt raw background error object:", error);
        void sendMessageWithoutDraftEffect(
          bot.api,
          ctx.chat!.id,
          t("bot.prompt_send_error"),
          withMessageThreadId(undefined, messageThreadId),
        ).catch(() => {});
      },
    });

    return true;
  } catch (err) {
    if (currentSession) {
      foregroundSessionState.markIdle(currentSession.id, activeScope);
    }
    logger.error("Error in prompt handler:", err);
    if (interactionManager.getSnapshot()) {
      clearAllInteractionState("message_handler_error");
    }
    await ctx.reply(t("error.generic"));
    return false;
  }
}
