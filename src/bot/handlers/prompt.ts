import { Bot, Context } from "grammy";
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { clearSession, getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import { getCurrentProject, setConversationCurrentProject, clearProject } from "../../settings/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel, switchToFallbackModel, getFallbackModel, getRuntimeModelCatalog } from "../../model/manager.js";
import { isModelUnavailableError } from "../utils/model-error-patterns.js";
import { deletePromptRetryContext, setPromptRetryContext } from "./prompt-context.js";
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
import { sshManager } from "../../utils/ssh-manager.js";
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

// Track whether SSH was active per conversation scope so we can detect
// connects / disconnects and reset session + project accordingly.
const sshActiveByScope = new Map<string, boolean>();

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

function isSessionNotFoundError(error: unknown): boolean {
  if (!error) return false;

  // Plain string
  if (typeof error === "string") {
    const t = error.toLowerCase();
    return t.includes("session not found") || t.includes("notfounderror");
  }

  // SDK error object — check nested fields before falling back to stringify
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;

    if (typeof obj.message === "string" && obj.message.toLowerCase().includes("session not found")) return true;
    if (typeof obj.name === "string" && obj.name.toLowerCase().includes("notfound")) return true;

    const data = obj.data as Record<string, unknown> | undefined;
    if (data && typeof data.message === "string" && data.message.toLowerCase().includes("session not found")) return true;

    // Last resort
    try {
      const t = JSON.stringify(error).toLowerCase();
      return t.includes("session not found") || t.includes("notfounderror");
    } catch {
      return false;
    }
  }

  return false;
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

async function retryPromptWithSshRecovery({
  promptOptions,
  sessionId,
  logRetrySuccess,
  routingContext,
  promptErrorLogContext,
}: RetryPromptOptions): Promise<{ error: unknown | null }> {
  const userId = routingContext.scope?.userId;
  if (!userId || !sshManager.isSshActive(userId)) {
    return { error: new Error("not-ssh") };
  }

  const healthy = await sshManager.isTunnelHealthy(userId);
  if (healthy) {
    // Tunnel is fine, no recovery needed — just retry
  } else {
    logger.warn(`[Bot] SSH tunnel unhealthy for user ${userId}, attempting reconnection`);
    const credentials = await sshManager.loadCredentials(userId);
    if (!credentials) {
      logger.error(`[Bot] No saved SSH credentials for user ${userId}, cannot recover`);
      await sshManager.disconnect(userId).catch(() => {});
      return { error: new Error("ssh recovery failed: no saved credentials") };
    }

    try {
      await sshManager.connect(userId, credentials.details, credentials.auth, credentials.deployTarget);
      await sshManager.bootstrapRemoteServer(userId);
      logger.info(`[Bot] SSH connection recovered for user ${userId}`);
    } catch (reconnectErr) {
      logger.error(`[Bot] SSH reconnection failed for user ${userId}:`, reconnectErr);
      await sshManager.disconnect(userId).catch(() => {});
      return { error: new Error(`ssh recovery failed: ${String(reconnectErr)}`) };
    }
  }

  logger.info(`[Bot] Retrying session.promptAsync after SSH recovery: sessionId=${sessionId}`);
  try {
    const retryResult = await opencodeClient.session.promptAsync(promptOptions);
    const retryError = getSdkResponseError(retryResult);
    if (retryError) {
      logger.error("[Bot] session.promptAsync SSH-recovery retry also returned an error", promptErrorLogContext);
      return { error: retryError };
    }
    if (logRetrySuccess) {
      logger.info("[Bot] session.prompt SSH-recovery retry succeeded");
    }
    return { error: null };
  } catch (retryError) {
    logger.error("[Bot] session.promptAsync SSH-recovery retry also threw:", retryError);
    return { error: retryError };
  }
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

  // Detect SSH connect / disconnect and reset session + project.
  // Scope is guaranteed to be set here (unlike in callback handlers).
  if (scope) {
    const scopeKey = buildTelegramConversationScopeKey(scope);
    const sshNow = sshManager.isSshActive(scope.userId);
    const sshBefore = sshActiveByScope.get(scopeKey);
    if (sshBefore !== undefined && sshBefore !== sshNow) {
      logger.info(
        `[Bot] SSH state changed ${sshBefore} -> ${sshNow} for scope ${scopeKey}, clearing session + project`,
      );
      clearSession();
      clearProject();

      // Refresh model catalog from the target server and verify
      // the current model exists there.  If not, fall back to the
      // default model for this server.
      try {
        const catalog = await getRuntimeModelCatalog({ force: true });
        const currentModel = getStoredModel();
        if (currentModel.providerID && currentModel.modelID) {
          const provider = catalog.providers.find(
            (p) => p.providerID === currentModel.providerID,
          );
          const modelExists = provider?.models.some(
            (m) => m.modelID === currentModel.modelID,
          );
          if (!modelExists) {
            logger.info(
              `[Bot] Model ${currentModel.providerID}/${currentModel.modelID} not available on target server, falling back`,
            );
            switchToFallbackModel();
          }
        }

        // Update the reply keyboard so the user sees the correct model
        // and context for the newly active server.
        if (!pinnedMessageManager.isInitialized()) {
          pinnedMessageManager.initialize(bot.api, ctx.chat!.id);
        }
        if (pinnedMessageManager.getContextLimit() === 0) {
          await pinnedMessageManager.refreshContextLimit();
        }
        keyboardManager.initialize(bot.api, ctx.chat!.id);
        const contextInfo = pinnedMessageManager.getContextInfo();
        if (contextInfo) {
          keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
        }
      } catch (err) {
        logger.warn("[Bot] Failed to refresh model catalog on SSH state change:", err);
      }
    }
    sshActiveByScope.set(scopeKey, sshNow);
  }

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

  // When SSH is active the current session may have been created on the local
  // OpenCode server.  Verify it exists on the remote end; if not, discard it
  // so a fresh session is created transparently.
  if (currentSession && scope && sshManager.isSshActive(scope.userId)) {
    const sessionIdToVerify = currentSession.id;
    const sessionDirToVerify = currentSession.directory;
    try {
      const { data: statusData, error: statusErr } = await opencodeClient.session.status({
        directory: sessionDirToVerify,
      });
      if (
        statusErr ||
        !statusData ||
        !(statusData as Record<string, unknown>)[sessionIdToVerify]
      ) {
        logger.info(
          `[Bot] Session ${sessionIdToVerify} not found on remote server (SSH active), discarding`,
        );
        clearSession();
        currentSession = null;
      }
    } catch {
      logger.warn(
        `[Bot] Failed to verify session ${sessionIdToVerify} (SSH active), discarding`,
      );
      clearSession();
      currentSession = null;
    }
  }

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
  summaryAggregator.setBotAndChatId(bot, ctx.chat!.id, extractMessageThreadIdFromContext(ctx));

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
        const attachmentText = fileParts.length === 1 ? "See attached file" : "See attached files";
        parts.unshift({ type: "text", text: attachmentText });
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
    if (effectivePromptText) {
      setPromptRetryContext(currentSession.id, currentSession.directory, effectivePromptText, currentAgent);
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
            // When SSH is active, try SSH tunnel recovery first
            if (routingContext.scope?.userId && sshManager.isSshActive(routingContext.scope.userId)) {
              logger.warn(
                `[Bot] session.prompt returned network error with SSH active, attempting SSH recovery: sessionId=${currentSession.id}`,
              );
              const sshRetryResult = await retryPromptWithSshRecovery({
                promptOptions,
                sessionId: currentSession.id,
                logRetrySuccess: true,
                routingContext,
                promptErrorLogContext,
              });
              if (!sshRetryResult.error) {
                return;
              }
            }

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
            // Retry failed — give up
          }

          if (isSessionNotFoundError(error) && routingContext.scope?.userId && sshManager.isSshActive(routingContext.scope.userId)) {
            logger.warn(
              `[Bot] Session not found on remote server after SSH switch, creating new session: oldSessionId=${currentSession.id}`,
            );
            try {
              // Create a fresh session on the remote server
              const { data: newSession, error: createError } = await opencodeClient.session.create({
                directory: currentSession.directory,
              });
              if (createError || !newSession) {
                logger.error("[Bot] Failed to create session on remote server", createError);
              } else {
                logger.info(`[Bot] Created new session on remote server: id=${newSession.id}`);
                setCurrentSession({ id: newSession.id, title: newSession.title, directory: currentSession.directory });
                const newPromptOptions = { ...promptOptions, sessionID: newSession.id };
                const retryResult = await opencodeClient.session.promptAsync(newPromptOptions);
                const retryError = getSdkResponseError(retryResult);
                if (!retryError) {
                  logger.info("[Bot] Session-recreate retry succeeded");
                  if (!routingContext.suppressSendErrorMessage) {
                    void runWithTelegramConversationScope(routingContext.scope, () =>
                      routingContext.bot.api.sendMessage(
                        routingContext.target.chatId,
                        t("bot.session_recreated_remote"),
                        withMessageThreadId(undefined, routingContext.target.messageThreadId),
                      ).catch(() => {}),
                    ).catch(() => {});
                  }
                  return;
                }
                logger.error("[Bot] Session-recreate retry also failed", retryError);
              }
            } catch (recreateErr) {
              logger.error("[Bot] Session-recreate error:", recreateErr);
            }
          }

          const errorText = String(error);
          if (isModelUnavailableError(errorText)) {
            const fallbackModel = switchToFallbackModel();
            if (fallbackModel) {
              const fallbackName = `${fallbackModel.providerID}/${fallbackModel.modelID}`;
              logger.warn(
                `[Bot] session.prompt returned model-unavailable error, switching to fallback ${fallbackName}: sessionId=${currentSession.id}`,
              );
              if (!routingContext.suppressSendErrorMessage) {
                const originalModelName = promptOptions.model
                  ? `${promptOptions.model.providerID}/${promptOptions.model.modelID}`
                  : "default";
                void runWithTelegramConversationScope(routingContext.scope, () =>
                  routingContext.bot.api
                    .sendMessage(
                      routingContext.target.chatId,
                      t("bot.model_fallback_switch", { model: originalModelName, fallback: fallbackName }),
                      withMessageThreadId(undefined, routingContext.target.messageThreadId),
                    )
                    .catch(() => {}),
                ).catch(() => {});
              }
              const fallbackPromptOptions = {
                ...promptOptions,
                model: { providerID: fallbackModel.providerID, modelID: fallbackModel.modelID },
                variant: fallbackModel.variant,
              };
              try {
                const fallbackResult = await opencodeClient.session.promptAsync(fallbackPromptOptions);
                const fallbackError = getSdkResponseError(fallbackResult);
                if (!fallbackError) {
                  deletePromptRetryContext(currentSession.id);
                  logger.info("[Bot] Fallback model retry succeeded");
                  return;
                }
                logger.error("[Bot] Fallback model retry also returned an error", { fallbackError });
              } catch (fallbackErr) {
                logger.error("[Bot] Fallback model retry threw:", fallbackErr);
              }
            }
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
          // When SSH is active, try SSH tunnel recovery first
          if (routingContext.scope?.userId && sshManager.isSshActive(routingContext.scope.userId)) {
            logger.warn(
              `[Bot] session.prompt threw network error with SSH active, attempting SSH recovery: sessionId=${currentSession.id}`,
            );
            const sshRetryResult = await retryPromptWithSshRecovery({
              promptOptions,
              sessionId: currentSession.id,
              logRetrySuccess: true,
              routingContext,
              promptErrorLogContext,
            });
            if (!sshRetryResult.error) {
              return;
            }
          }

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
          // Retry failed — give up
        }

        if (isSessionNotFoundError(error) && routingContext.scope?.userId && sshManager.isSshActive(routingContext.scope.userId)) {
          logger.warn(
            `[Bot] Session not found on remote server (exception), creating new session: oldSessionId=${currentSession.id}`,
          );
          try {
            const { data: newSession, error: createError } = await opencodeClient.session.create({
              directory: currentSession.directory,
            });
            if (createError || !newSession) {
              logger.error("[Bot] Failed to create session on remote server", createError);
            } else {
              logger.info(`[Bot] Created new session on remote server (onError): id=${newSession.id}`);
              setCurrentSession({ id: newSession.id, title: newSession.title, directory: currentSession.directory });
              const newPromptOptions = { ...promptOptions, sessionID: newSession.id };
              const retryResult = await opencodeClient.session.promptAsync(newPromptOptions);
              const retryError = getSdkResponseError(retryResult);
              if (!retryError) {
                logger.info("[Bot] Session-recreate retry (onError) succeeded");
                if (!routingContext.suppressSendErrorMessage) {
                  void runWithTelegramConversationScope(routingContext.scope, () =>
                    routingContext.bot.api.sendMessage(
                      routingContext.target.chatId,
                      t("bot.session_recreated_remote"),
                      withMessageThreadId(undefined, routingContext.target.messageThreadId),
                    ).catch(() => {}),
                  ).catch(() => {});
                }
                return;
              }
              logger.error("[Bot] Session-recreate retry (onError) also failed", retryError);
            }
          } catch (recreateErr) {
            logger.error("[Bot] Session-recreate (onError) error:", recreateErr);
          }
        }

        const errorText = String(error);
        if (isModelUnavailableError(errorText)) {
          const fallbackModel = switchToFallbackModel();
          if (fallbackModel) {
            const fallbackName = `${fallbackModel.providerID}/${fallbackModel.modelID}`;
            logger.warn(
              `[Bot] session.prompt threw model-unavailable error, switching to fallback ${fallbackName}: sessionId=${currentSession.id}`,
            );
            if (!routingContext.suppressSendErrorMessage) {
              const originalModelName = promptOptions.model
                ? `${promptOptions.model.providerID}/${promptOptions.model.modelID}`
                : "default";
              void runWithTelegramConversationScope(routingContext.scope, () =>
                routingContext.bot.api
                  .sendMessage(
                    routingContext.target.chatId,
                    t("bot.model_fallback_switch", { model: originalModelName, fallback: fallbackName }),
                    withMessageThreadId(undefined, routingContext.target.messageThreadId),
                  )
                  .catch(() => {}),
              ).catch(() => {});
            }
            const fallbackPromptOptions = {
              ...promptOptions,
              model: { providerID: fallbackModel.providerID, modelID: fallbackModel.modelID },
              variant: fallbackModel.variant,
            };
            try {
              const fallbackResult = await opencodeClient.session.promptAsync(fallbackPromptOptions);
              const fallbackError = getSdkResponseError(fallbackResult);
              if (!fallbackError) {
                deletePromptRetryContext(currentSession.id);
                logger.info("[Bot] Fallback model retry succeeded");
                return;
              }
              logger.error("[Bot] Fallback model retry also returned an error", { fallbackError });
            } catch (fallbackErr) {
              logger.error("[Bot] Fallback model retry threw:", fallbackErr);
            }
          }
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
