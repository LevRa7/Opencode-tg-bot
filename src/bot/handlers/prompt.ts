import { Bot, Context } from "grammy";
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { clearSession, getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import { getCurrentProject, setConversationCurrentProject } from "../../settings/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import {
  extractMessageThreadIdFromContext,
  extractThreadTargetFromContext,
  isForumChat,
  type TelegramThreadTarget,
  withMessageThreadId,
} from "../utils/message-thread.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { interactionManager } from "../../interaction/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { formatErrorDetails } from "../../utils/error-format.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { threadContextManager } from "../../thread/manager.js";
import { getDefaultProject } from "../../project/manager.js";
import { processManager } from "../../process/manager.js";
import { assistantRunState } from "../assistant-run-state.js";
import { IncomingMediaBatch } from "../incoming-media-batch.js";
import { extractMessageMetadata, type ResolvedDeferredItem } from "../../media/batch-types.js";
import {
  getCurrentTelegramConversationScope,
  buildTelegramConversationScopeKey,
  extractTelegramConversationScopeFromContext,
  runWithTelegramConversationScope,
  type TelegramConversationScope,
} from "../../telegram/scope.js";
import { attachManager } from "../../attach/manager.js";
import { attachSessionForScope } from "../../attach/service.js";
import { showPermissionRequest } from "./permission.js";
import { showCurrentQuestion } from "./question.js";
import { externalInputSuppression } from "../../external-input/suppression.js";

const PROMPT_TIMEOUT_MS = 60_000;

function getEffectivePromptText(parts: Array<TextPartInput | FilePartInput>): string | null {
  const firstTextPart = parts.find(
    (part): part is TextPartInput => part.type === "text" && typeof part.text === "string",
  );

  return firstTextPart?.text ?? null;
}

function isNetworkError(error: unknown): boolean {
  const errorText = String(error).toLowerCase();
  return errorText.includes("fetch failed") || errorText.includes("econnrefused");
}

function getSdkResponseError(result: unknown): unknown | null {
  if (typeof result !== "object" || result === null || !("error" in result)) {
    return null;
  }

  return (result as { error?: unknown }).error ?? null;
}

interface RetryPromptOptions {
  promptOptions: Parameters<typeof opencodeClient.session.promptAsync>[0];
  sessionId: string;
  logRetrySuccess: boolean;
  routingContext: PromptRoutingContext;
  promptErrorLogContext: Record<string, unknown>;
}

async function retryPromptWithTenantRestart({
  promptOptions,
  sessionId,
  logRetrySuccess,
  routingContext: _routingContext,
  promptErrorLogContext,
}: RetryPromptOptions): Promise<{ error: unknown | null }> {
  try {
    const restartResult = await processManager.ensureRuntime();
    if (!restartResult.success) {
      logger.error(`[Bot] Failed to restart tenant: ${restartResult.error}`);
      return { error: new Error(`tenant restart failed: ${restartResult.error}`) };
    }

    logger.info(`[Bot] Tenant restarted, retrying session.promptAsync: sessionId=${sessionId}`);
    const retryResult = await opencodeClient.session.promptAsync(promptOptions);
    const retryError = getSdkResponseError(retryResult);
    if (retryError) {
      logger.error("[Bot] session.promptAsync retry also returned an error", promptErrorLogContext);
      return { error: retryError };
    }

    if (logRetrySuccess) {
      logger.info("[Bot] session.prompt retry succeeded");
    }
    return { error: null };
  } catch (retryError) {
    logger.error("[Bot] session.promptAsync retry also threw:", retryError);
    return { error: retryError };
  }
}

async function wrapPromptDispatchWithTimeout<T>(promptPromise: Promise<T>): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`session.promptAsync timed out after ${PROMPT_TIMEOUT_MS}ms`)),
      PROMPT_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([promptPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

const promptResponseModes = new Map<string, PromptResponseMode>();

interface PromptRoutingContext {
  bot: Bot<Context>;
  target: TelegramThreadTarget;
  scope: TelegramConversationScope | null;
  isForumChat: boolean;
  sourceMessageId?: number;
  suppressSendErrorMessage: boolean;
}

function resolveBusyScopeForSession(
  sessionId: string,
  fallbackScope?: TelegramConversationScope | null,
): TelegramConversationScope | null {
  return fallbackScope ?? attachManager.getScopeForSession(sessionId) ?? getCurrentTelegramConversationScope();
}

const promptRoutingBySessionId = new Map<string, PromptRoutingContext>();

// Atomic session claim: prevents race between concurrent processUserPrompt calls
// claimSessionRunId ensures only one caller proceeds past the busy check
const sessionClaimMap = new Map<string, number>();
let nextClaimRunId = 1;

function tryClaimSession(sessionId: string): number | false {
  if (sessionClaimMap.has(sessionId)) {
    return false;
  }
  const runId = nextClaimRunId++;
  sessionClaimMap.set(sessionId, runId);
  return runId;
}

function releaseSessionClaim(sessionId: string, runId: number): void {
  if (sessionClaimMap.get(sessionId) === runId) {
    sessionClaimMap.delete(sessionId);
  }
}

export type PromptResponseMode = "text_only" | "text_and_tts";

export type ProcessPromptOptions = {
  responseMode?: PromptResponseMode;
  isFollowUpBatch?: boolean;
  suppressSendErrorMessage?: boolean;
};

function setPromptRoutingContext(sessionId: string, routing: PromptRoutingContext): void {
  promptRoutingBySessionId.set(sessionId, routing);
}

export function getPromptRoutingContext(sessionId: string): PromptRoutingContext | null {
  return promptRoutingBySessionId.get(sessionId) ?? null;
}

function clearPromptRoutingContext(sessionId: string): void {
  promptRoutingBySessionId.delete(sessionId);
}

export function clearPromptRouting(sessionId: string): void {
  clearPromptRoutingContext(sessionId);
}

export function setPromptResponseMode(sessionId: string, responseMode: PromptResponseMode): void {
  promptResponseModes.set(sessionId, responseMode);
}

export function clearPromptResponseMode(sessionId: string): void {
  promptResponseModes.delete(sessionId);
}

export function consumePromptResponseMode(sessionId: string): PromptResponseMode | null {
  const responseMode = promptResponseModes.get(sessionId) ?? null;
  promptResponseModes.delete(sessionId);
  return responseMode;
}

export async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
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

async function resetMismatchedSessionContext(sessionId?: string): Promise<void> {
  clearScopedSessionRuntime(sessionId ?? "", "session_mismatch_reset");
  if (sessionId) {
    foregroundSessionState.markIdle(sessionId, attachManager.getScopeForSession(sessionId));
  }
  clearSession();
  threadContextManager.clearSessionForActiveContext();
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
  deferredBatch?: IncomingMediaBatch<
    ResolvedDeferredItem,
    ResolvedDeferredItem,
    DeferredPromptBatchResolution
  >;
}

interface DeferredPromptBatchResolution {
  text: string;
  firstContext?: Context;
}

export interface ContextInfo {
  tokensUsed: number;
  tokensLimit: number;
}

export interface SessionInfo {
  id: string;
  directory: string;
}

export interface StoredModelInfo {
  providerID: string;
  modelID: string;
  variant?: string;
}

const COMPACTION_THRESHOLD = 0.95;

/**
 * Checks if the prompt should be auto-compacted based on context usage.
 * Only compacts if no file parts are present to avoid losing media context.
 */
export function shouldAutoCompactBeforePrompt(options: {
  text: string;
  fileParts: FilePartInput[];
  contextInfo: ContextInfo;
}): boolean {
  if (options.fileParts.length > 0) return false;
  const ratio = options.contextInfo.tokensUsed / options.contextInfo.tokensLimit;
  return ratio >= COMPACTION_THRESHOLD;
}

/**
 * Attempts to auto-compact the session by summarizing it if the threshold is reached.
 */
export async function maybeAutoCompactBeforePrompt(options: {
  text: string;
  fileParts: FilePartInput[];
  contextInfo: ContextInfo;
  session: SessionInfo;
  storedModel: StoredModelInfo;
  summarizeSession: (params: {
    sessionID: string;
    directory: string;
    providerID: string;
    modelID: string;
  }) => Promise<{ error: unknown }>;
}): Promise<boolean> {
  if (!shouldAutoCompactBeforePrompt(options)) return false;

  logger.info(
    `[Bot] Context usage at ${Math.round((options.contextInfo.tokensUsed / options.contextInfo.tokensLimit) * 100)}%, triggering auto-compaction for session=${options.session.id}`,
  );

  const result = await options.summarizeSession({
    sessionID: options.session.id,
    directory: options.session.directory,
    providerID: options.storedModel.providerID,
    modelID: options.storedModel.modelID,
  });

  if (result.error) {
    logger.warn(`[Bot] Auto-compaction failed for session=${options.session.id}`, result.error);
    return false;
  }

  return true;
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
  options: ProcessPromptOptions = {},
): Promise<boolean> {
  const { bot, ensureEventSubscription, deferredBatch } = deps;
  const responseMode = options.responseMode ?? "text_only";
  const suppressSendErrorMessage = options.suppressSendErrorMessage === true;

  // In test mode (Vitest), skip the batch window and send immediately
  const isVitest = typeof process !== "undefined" && !!process.env?.VITEST;

  // Batch window: collect all messages before sending to OpenCode.
  // First message opens a 1-second window. Follow-ups extend to 3s from the last.
  // After 3s of silence, the batch flushes as a single prompt via sendDeferredFollowUp.
  if (!isVitest && deferredBatch && !options.isFollowUpBatch) {
    const contextScope = extractTelegramConversationScopeFromContext(ctx);
    const scopeKey = buildTelegramConversationScopeKey(contextScope);
    const isDeferred = deferredBatch.enqueueDeferredItem({
      scopeKey,
      deferredItem: {
        correlationId: `prompt:${ctx.message?.message_id ?? Date.now()}`,
        kind: "text",
        directText: text,
        previewText: text,
        contextText: text,
        ctx,
        metadata: extractMessageMetadata(ctx),
      },
    });
    if (isDeferred) {
      return true;
    }

    // First message in this batch — open window with 1 second initial expiry
    await deferredBatch.deferItem({
      scopeKey,
      initialExpiresMs: 1000,
      deferredItem: {
        correlationId: `prompt:${ctx.message?.message_id ?? Date.now()}`,
        kind: "text",
        directText: text,
        previewText: text,
        contextText: text,
        ctx,
        metadata: extractMessageMetadata(ctx),
      },
    });
    return true;
  }

  let currentProject = getCurrentProject();
  if (!currentProject) {
    const defaultProject = await getDefaultProject();
    if (!defaultProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return false;
    }

    currentProject = defaultProject;
    setConversationCurrentProject(defaultProject);
    threadContextManager.bindProjectToActiveContext(defaultProject);
  }

  const scope = extractTelegramConversationScopeFromContext(ctx);
  const target = extractThreadTargetFromContext(ctx);

  if (!target) {
    logger.error("[Bot] Cannot process prompt: Telegram target is missing");
    await ctx.reply(t("error.generic"));
    return false;
  }

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
    await resetMismatchedSessionContext(currentSession.id);
    await ctx.reply(t("bot.session_reset_project_mismatch"));
    return false;
  }

  if (!currentSession) {
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
    const activeScope = threadContextManager.getActiveScope();
    if (activeScope) {
      await attachSessionForScope({
        scope: activeScope,
        session: currentSession,
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

    await ctx.reply(
      t("bot.session_created", { title: session.title }),
      withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
    );
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
  }

  void ensureEventSubscription(currentSession.directory);

  // Atomic session claim: only one call proceeds past the busy check
  const claimRunId = tryClaimSession(currentSession.id);
  if (claimRunId === false) {
    logger.info(`[Bot] Session ${currentSession.id} already claimed, ignoring`);
    await ctx.reply(t("bot.session_busy"));
    return false;
  }

  const busyScope = threadContextManager.getActiveScope() ?? scope;
  foregroundSessionState.markBusy(currentSession.id, currentSession.directory, resolveBusyScopeForSession(currentSession.id, busyScope));
  const sessionIsBusy = await isSessionBusy(currentSession.id, currentSession.directory);

  releaseSessionClaim(currentSession.id, claimRunId);

  if (sessionIsBusy) {
    foregroundSessionState.markIdle(currentSession.id, resolveBusyScopeForSession(currentSession.id, busyScope));
    logger.info(`[Bot] Ignoring new prompt: session ${currentSession.id} is busy`);
    await ctx.reply(t("bot.session_busy"));
    return false;
  }

  if (assistantRunState.isRunActive(currentSession.id)) {
    foregroundSessionState.markIdle(currentSession.id, resolveBusyScopeForSession(currentSession.id, busyScope));
    logger.info(`[Bot] Ignoring new prompt: session ${currentSession.id} has an active local run`);
    await ctx.reply(t("bot.session_busy"));
    return false;
  }

  const activeScope = threadContextManager.getActiveScope();
  if (activeScope) {
    await attachSessionForScope({
      scope: activeScope,
      session: currentSession,
      reason: "prompt",
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

  summaryAggregator.setSession(currentSession.id);

  try {
    const currentAgent = getStoredAgent();
    const storedModel = getStoredModel();

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

    // Use stored model (from settings or config)
    if (storedModel.providerID && storedModel.modelID) {
      promptOptions.model = {
        providerID: storedModel.providerID,
        modelID: storedModel.modelID,
      };

      // Add variant if specified
      if (storedModel.variant) {
        promptOptions.variant = storedModel.variant;
      }
    }

    const promptErrorLogContext = {
      sessionId: currentSession.id,
      directory: currentSession.directory,
      agent: currentAgent || "default",
      modelProvider: storedModel.providerID || "default",
      modelId: storedModel.modelID || "default",
      variant: storedModel.variant || "default",
      promptLength: text.length,
      fileCount: fileParts.length,
    };

    logger.info(
      `[Bot] Calling session.promptAsync (fire-and-forget) with agent=${currentAgent}, fileCount=${fileParts.length}...`,
    );

    assistantRunState.startRun(currentSession.id, {
      startedAt: Date.now(),
      configuredAgent: currentAgent,
      configuredProviderID: storedModel.providerID,
      configuredModelID: storedModel.modelID,
    });
    setPromptResponseMode(currentSession.id, responseMode);
    const routingContext = {
      bot,
      target,
      scope,
      isForumChat: isForumChat(ctx),
      sourceMessageId:
        typeof ctx.message?.message_id === "number" ? ctx.message.message_id : undefined,
      suppressSendErrorMessage,
    };
    setPromptRoutingContext(currentSession.id, routingContext);

    const effectivePromptText = getEffectivePromptText(parts);
    if (scope && effectivePromptText) {
      externalInputSuppression.rememberSelfInput(currentSession.id, scope, effectivePromptText);
    }

    // CRITICAL: DO NOT wait for the full assistant turn to complete.
    // If we wait, the handler will not finish and grammY will not call getUpdates,
    // which blocks receiving button callback_query updates.
    // The processing result will arrive via SSE events.
    let promptDispatchPromise: Promise<Awaited<ReturnType<typeof opencodeClient.session.promptAsync>>>;
    try {
      promptDispatchPromise = wrapPromptDispatchWithTimeout(
        opencodeClient.session.promptAsync(promptOptions),
      );
    } catch (error) {
      promptDispatchPromise = Promise.reject(error);
    }

    safeBackgroundTask({
      taskName: "session.promptAsync",
      task: () => promptDispatchPromise,
      onSuccess: async (result) => {
        const error = getSdkResponseError(result);
        if (error) {
          if (isNetworkError(error)) {
            logger.warn(
              `[Bot] session.prompt returned network error, attempting tenant restart and retry: sessionId=${currentSession.id}`,
            );
            const retryResult = await retryPromptWithTenantRestart({
              promptOptions,
              sessionId: currentSession.id,
              logRetrySuccess: true,
              routingContext,
              promptErrorLogContext,
            });
            if (!retryResult.error) {
              return;
            }
            // Retry failed — fall through to error notification below
          }

          foregroundSessionState.markIdle(
            currentSession.id,
            resolveBusyScopeForSession(currentSession.id, routingContext.scope),
          );
          assistantRunState.clearRun(currentSession.id, "prompt_error_result");
          clearPromptResponseMode(currentSession.id);
          const details = formatErrorDetails(error, 6000);
          logger.error("[Bot] session.prompt error", { ...promptErrorLogContext, details });

          const routing = getPromptRoutingContext(currentSession.id) ?? routingContext;
          if (routing) {
            void runWithTelegramConversationScope(routing.scope, () => {
              if (routing.suppressSendErrorMessage) {
                return Promise.resolve();
              }
              return routing.bot.api.sendMessage(
                routing.target.chatId,
                t("bot.prompt_send_error"),
                withMessageThreadId(undefined, routing.target.messageThreadId),
              );
            }).catch(() => {});
          }
          return;
        }

        logger.info("[Bot] session.promptAsync accepted");
      },
      onError: async (error) => {
        if (isNetworkError(error)) {
          logger.warn(
            `[Bot] session.prompt failed with network error, attempting tenant restart and retry: sessionId=${currentSession.id}`,
          );
          const retryResult = await retryPromptWithTenantRestart({
            promptOptions,
            sessionId: currentSession.id,
            logRetrySuccess: true,
            routingContext,
            promptErrorLogContext,
          });
          if (!retryResult.error) {
            return;
          }
          // Retry failed — fall through to error notification below
        }

        foregroundSessionState.markIdle(
          currentSession.id,
          resolveBusyScopeForSession(currentSession.id, routingContext.scope),
        );
        assistantRunState.clearRun(currentSession.id, "prompt_error_exception");
        clearPromptResponseMode(currentSession.id);
        const details = formatErrorDetails(error, 6000);
        logger.error("[Bot] session.prompt error", { ...promptErrorLogContext, details });
        const routing = getPromptRoutingContext(currentSession.id) ?? routingContext;
        if (routing) {
          void runWithTelegramConversationScope(routing.scope, () => {
            if (routing.suppressSendErrorMessage) {
              return Promise.resolve();
            }
            return routing.bot.api.sendMessage(
              routing.target.chatId,
              t("bot.prompt_send_error"),
              withMessageThreadId(undefined, routing.target.messageThreadId),
            );
          }).catch(() => {});
        }
      },
    });

    if (deferredBatch && !options.isFollowUpBatch) {
      const windowScopeKey = buildTelegramConversationScopeKey(
        extractTelegramConversationScopeFromContext(ctx),
      );
      deferredBatch
        .sendDirectPrompt({
          scopeKey: windowScopeKey,
          directPrompt: {
            correlationId: `direct:${ctx.message?.message_id ?? Date.now()}`,
            kind: "text",
            directText: "",
          },
        })
        .catch((openErr: unknown) => {
          logger.error("[Bot] Failed to open batch window", openErr);
        });
    }

    return true;
  } catch (err) {
    if (currentSession) {
      foregroundSessionState.markIdle(currentSession.id, resolveBusyScopeForSession(currentSession.id, scope));
      assistantRunState.clearRun(currentSession.id, "prompt_handler_exception");
    }
    logger.error("Error in prompt handler:", err);
    if (interactionManager.getSnapshot()) {
      clearAllInteractionState("message_handler_error");
    }
    await ctx.reply(t("error.generic"));
    return false;
  }
}
