import { Bot, Context, InlineKeyboard, InputFile, NextFunction } from "grammy";
import type { Api, RawApi } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import type { MessageFormatMode } from "../config.js";
import type { TelegramRenderedPart } from "../telegram/render/types.js";
import { authMiddleware, handleAccessApprovalCallback } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { unknownCommandMiddleware } from "./middleware/unknown-command.js";
import { syncAuthorizedChatCommands } from "./utils/command-sync.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { statusCommand } from "./commands/status.js";
import { restartCommand } from "./commands/restart.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  STOP_BUTTON_TEXT_PATTERN,
  NEW_WINDOW_BUTTON_TEXT_PATTERN,
} from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect, handleBackgroundSessionOpen, buildBackgroundSessionOpenKeyboard } from "./commands/sessions.js";
import { newCommand } from "./commands/new.js";
import { modelCommand } from "./commands/model.js";
import { variantCommand } from "./commands/variant.js";
import { compactCommand } from "./commands/compact.js";
import { handleSettingsCallback, settingsCommand } from "./commands/settings.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { abortCommand, abortCurrentOperation } from "./commands/abort.js";
import { handleServer } from "./commands/server.js";
import { serverWebCommand, handleServerCallback } from "./commands/server-web.js";
import { handleOnboardingCallback as handleWebOnboardingCallback, showWebPanelOnboarding } from "../server/start-flow.js";
import { handleOnboardingCallback } from "./handlers/onboarding-flow.js";
import { connectCommand, handleProviderAuth, handleProviderInput, isProviderApiKeyPrompt, isAnyProviderPrompt, startProviderAuth } from "./commands/connect.js";
import { shareCommand, unshareCommand } from "./commands/share.js";
import { forkCommand, isNotFoundError } from "./commands/fork.js";
import { revertCommand } from "./commands/revert.js";
import { deleteMessageCommand } from "./commands/delete-message.js";
import { memoryCommand } from "./commands/memory.js";
import { detachCommand } from "./commands/detach.js";
import { opencodeStartCommand } from "./commands/opencode-start.js";
import { opencodeStopCommand } from "./commands/opencode-stop.js";
import { renameCommand, handleRenameCancel, handleRenameTextAnswer } from "./commands/rename.js";
import { handleTaskCallback, handleTaskTextInput, taskCommand } from "./commands/task.js";
import { handleTaskListCallback, taskListCommand } from "./commands/tasklist.js";
import {
  commandsCommand,
  handleCommandsCallback,
  handleCommandTextArguments,
} from "./commands/commands.js";
import {
  sshCommand,
  handleSshCallback,
  handleSshTextArguments,
} from "./commands/ssh.js";
import { streamCommand } from "./commands/stream.js";
import { ttsCommand } from "./commands/tts.js";
import { terminalCommand } from "./commands/terminal.js";
import { openTerminalTopic } from "./commands/terminal.js";
import { isTerminalTopic, executeTerminalCommand, killTerminalProcess, loadTerminalTopics, takeTerminalScreenshot, handleTerminalScrollButton, getPtySession } from "./commands/terminal.js";
import { handleTerminalTextInput } from "./commands/terminal-text-handler.js";
import { worktreeCommand, handleWorktreeCallback } from "./commands/worktree.js";
import { openCommand, handleOpenCallback, clearOpenPathIndex } from "./commands/open.js";
import { clearLsPathIndex, handleLsCallback, lsCommand } from "./commands/ls.js";
import {
  skillsCommand,
  handleSkillsCallback,
  handleSkillTextArguments,
} from "./commands/skills.js";
import { handleMcpsCallback, mcpsCommand } from "./commands/mcps.js";
import {
  handleQuestionCallback,
  showCurrentQuestion,
  handleQuestionTextAnswer,
} from "./handlers/question.js";
import { handlePermissionCallback, showPermissionRequest, registerPermissionSendFn, unregisterPermissionSendFn } from "./handlers/permission.js";
import { handleAgentSelect, cycleAgentMode } from "./handlers/agent.js";
import { handleModelSelect, showModelSelectionMenu } from "./handlers/model.js";
import { handleVariantSelect } from "./handlers/variant.js";
import { handleCompactConfirm } from "./handlers/context.js";
import { handleInlineMenuCancel, clearActiveInlineMenu } from "./handlers/inline-menu.js";
import { questionManager } from "../question/manager.js";
import { interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { SessionType } from "../keyboard/types.js";
import { subscribeToEvents } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { formatToolInfo, getAssistantParseMode } from "../summary/formatter.js";
import {
  formatTechnicalProgressSync,
  formatTechnicalProgressWithDetails,
} from "../summary/technical-progress/formatter.js";
import { TelegraphClient } from "../telegraph/telegraph-client.js";
import { TelegraphPublishQueue } from "../telegraph/publish-queue.js";
import { ThinkingTelegraphAccumulator } from "../telegraph/thinking-accumulator.js";
import { SubagentTelegraphLogger } from "../telegraph/subagent-logger.js";
import { NoopDetailsPublisher } from "../telegraph/noop-details-publisher.js";
import { MultiKeyClient } from "../telegraph/multi-key-client.js";
import { TelegraphKeyPool } from "../telegraph/key-pool.js";
import { FileDiffLogger } from "../telegraph/diff-logger.js";
import { getTelegraphKeysRepo, getArticleBindingsRepo, getMessageJournalRepo, getMessageReactionsRepo, getMessageBookmarksRepo } from "../settings/manager.js";
import { ensureUserKeys } from "../telegraph/auto-register.js";
import { decryptToken } from "../telegraph/token-encryption.js";
import {
  createPlainRenderedParts,
  prepareAssistantFinalStreamingPayload,
  prepareAssistantStreamingPayload,
  renderAssistantFinalPartsSafe,
} from "./utils/assistant-rendering.js";
import { renderSubagentCards } from "../summary/subagent-formatter.js";
import { ToolMessageBatcher } from "../summary/tool-message-batcher.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { withTelegramRateLimitRetry } from "../utils/telegram-rate-limit-retry.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { createTelegramBotOptions } from "./telegram-client-options.js";
import { getLocale, setUserLocaleResolver, t } from "../i18n/index.js";
import { translateText } from "../translate/manager.js";
import {
  clearPromptResponseMode,
  clearPromptRouting,
  getPromptRoutingContext,
  processUserPrompt,
  isSessionBusy,
} from "./handlers/prompt.js";
import { deletePromptRetryContext, getPromptRetryContext } from "./handlers/prompt-context.js";
import { switchToFallbackModel, getStoredModel, getFallbackModel, isAlreadyOnFallbackModel } from "../model/manager.js";
import { isModelUnavailableError, isSseReadTimeoutError } from "./utils/model-error-patterns.js";
import { stripMessageTags } from "./utils/strip-message-tags.js";
import type { ModelInfo } from "../model/types.js";
import { IncomingMediaBatch } from "./incoming-media-batch.js";
import type { ResolvedDeferredItem } from "../media/batch-types.js";
import { composeDeferredMediaPrompt } from "../media/prompt-composer.js";
import { opencodeClient } from "../opencode/client.js";
import { getCurrentSession, setCurrentSession, type SessionInfo } from "../session/manager.js";
import { writeCurrentContext, findActiveSessionById } from "../active-session/tracker.js";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";
import { assistantRunState } from "./assistant-run-state.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleDocumentMessage } from "./handlers/document.js";
import { createMediaGroupAttachmentMiddleware } from "./handlers/media-group.js";
import { handleVideoMessage } from "./handlers/video.js";
import { handleLocationMessage, handleEditedLocation } from "./handlers/location.js";
import { handlePhotoMessage } from "./handlers/photo.js";
import { reconcileBusyState } from "./utils/busy-reconciliation.js";
import { shouldSuppressUserAbortSessionError } from "./utils/abort-error-suppression.js";
import { finalizeAssistantResponse } from "./utils/finalize-assistant-response.js";
import { sendTtsResponseForSession } from "./utils/send-tts-response.js";
import { MessageDraftStreamManager } from "./utils/message-draft-stream.js";
import { SequentialMessageDraftIdAllocator } from "./utils/message-draft-id.js";
import {
  clearAllThinkingBlockStreams,
  clearThinkingBlockStream,
  configureThinkingBlockDraftIdAllocator,
  finalizeThinkingBlockStream,
  streamThinkingBlocks,
} from "./utils/thinking-block-stream.js";
import {
  backgroundSessionTracker,
  type BackgroundSessionNotification,
} from "../background-session/tracker.js";
import { extractReasoningTitle, getVisibleReasoningText } from "./utils/thinking-message.js";
import { formatAssistantRunFooter } from "./utils/assistant-run-footer.js";
import { sendBotText, sendStreamedBotText } from "./utils/telegram-text.js";
import {
  createLocalFileFollowUpTracker,
  extractLocalFilePaths,
  isPathInsideRoot,
  isRealPathInsideRoot,
  prepareLocalFileFollowUpsFromPaths,
  type PreparedLocalFileFollowUp,
} from "./utils/telegram-local-file-follow-up.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { ResponseStreamer } from "./streaming/response-streamer.js";
import { ToolCallStreamer } from "./streaming/tool-call-streamer.js";
import { SessionDeliveryOrchestrator } from "./delivery/session-delivery-orchestrator.js";
import { threadContextManager } from "../thread/manager.js";
import { processManager } from "../process/manager.js";
import {
  withMessageThreadId,
  type TelegramThreadTarget,
  type TelegramDeliveryTarget,
} from "./utils/message-thread.js";
import { SubagentTopicService } from "./subagent-topics/service.js";
import { deliverChildTopicMessage } from "./subagent-topics/child-delivery.js";
import {
  getCurrentProject,
  getApprovedTelegramUserIds,
  getHideThinkingMessages,
  getHideToolCallMessages,
  getHideToolFileMessages,
  getReasoningMode,
  getSubagentTopicAutoDeleteMinutes,
  getTelegraphTranslateEnabled,
  getSubagentTopicsEnabled,
  getTenantRuntimeInfo,
  getFileDiffLogRepo,
  getFileArchiveRepo,
  getThinkingClearMode,
  getUserLocale,
  isMessageStreamingEnabled,
  setCurrentModelForScope,
} from "../settings/manager.js";
import {
  escapeHtml,
  formatReasoningBlock,
  formatToolCallAsSpoiler,
  markdownToHtml,
  splitTextIntoChunks,
  TELEGRAM_MESSAGE_LIMIT,
} from "./utils/reasoning-format.js";
import { extractToolOutput, formatToolOutputForRichMessage, isRichContent, trySendRichMessage } from "./utils/rich-message.js";
import {
  buildTelegramConversationScopeKey,
  extractTelegramConversationScopeFromContext,
  runWithTelegramConversationScope,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import { attachManager } from "../attach/manager.js";
import { attachSessionForScope } from "../attach/service.js";
import { externalInputSuppression } from "../external-input/suppression.js";
import {
  extractExternalUserInputText,
  formatExternalUserInputMessage,
} from "./utils/external-user-input.js";

let deferredBatch: IncomingMediaBatch<
  ResolvedDeferredItem,
  ResolvedDeferredItem,
  DeferredPromptBatchResolution
>;
let activeBotInstance: Bot<Context> | null = null;

interface DeferredPromptBatchResolution {
  text: string;
  firstContext?: Context;
}

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;
const RESPONSE_STREAM_THROTTLE_MS = config.bot.responseStreamThrottleMs;
const RESPONSE_STREAM_TEXT_LIMIT = 3800;
const SESSION_RETRY_PREFIX = "🔁";
const SUBAGENT_STREAM_PREFIX = "🧩";
const EXTERNAL_INPUT_NOTIFICATION_DEDUPE_TTL_MS = 15_000;

function prepareFinalStreamingPayload(messageText: string) {
  return prepareAssistantFinalStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", ".tmp");
const sessionCompletionTasks = new Map<string, Promise<void>>();
const externalInputNotificationExpiresAtByKey = new Map<string, number>();
const finalAssistantDeliveryOrchestrator = new SessionDeliveryOrchestrator({
  onError: async (error, item) => {
    logger.warn(
      `[Bot] Durable delivery failed: session=${item.sessionId}, channel=${item.channel}`,
      error,
    );
  },
});
const subagentTopicService = new SubagentTopicService({
  createForumTopic: async ({ chatId, name }) => {
    if (!activeBotInstance) {
      throw new Error("Bot not initialized for subagent topic creation");
    }

    const result = await activeBotInstance.api.createForumTopic(chatId, name);
    return {
      messageThreadId:
        (result as { message_thread_id?: number; messageThreadId?: number }).message_thread_id ??
        (result as { message_thread_id?: number; messageThreadId?: number }).messageThreadId ??
        0,
    };
  },
  deleteForumTopic: async ({ chatId, messageThreadId }) => {
    if (!activeBotInstance) {
      throw new Error("Bot not initialized for subagent topic deletion");
    }

    await activeBotInstance.api.deleteForumTopic(chatId, messageThreadId);
  },
});

function clearExpiredExternalInputNotificationDedupe(now = Date.now()): void {
  for (const [key, expiresAt] of externalInputNotificationExpiresAtByKey.entries()) {
    if (expiresAt <= now) {
      externalInputNotificationExpiresAtByKey.delete(key);
    }
  }
}

function shouldDeliverExternalInputNotification(options: {
  sessionId: string;
  scope: TelegramConversationScope;
  messageId: string;
}): boolean {
  clearExpiredExternalInputNotificationDedupe();
  const dedupeKey = `${options.sessionId}::${buildTelegramConversationScopeKey(options.scope)}::${options.messageId}`;
  if (externalInputNotificationExpiresAtByKey.has(dedupeKey)) {
    return false;
  }

  externalInputNotificationExpiresAtByKey.set(
    dedupeKey,
    Date.now() + EXTERNAL_INPUT_NOTIFICATION_DEDUPE_TTL_MS,
  );
  return true;
}

interface SessionRoutingContext {
  bot: Bot<Context>;
  target: {
    chatId: number;
    messageThreadId?: number;
  };
  deliveryTarget?: TelegramDeliveryTarget | null;
  scope: TelegramConversationScope | null;
  targetSource: "attached" | "prompt" | "recovery";
  sourceMessageId?: number;
}

interface OrderedPublicationInfo {
  eventTimeMs?: number;
  logicalMessageId: string;
}

interface DeferredValue<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const routingBySessionId = new Map<string, SessionRoutingContext>();
export { routingBySessionId };
const managedChildSessionIds = new Set<string>();
const pendingChildRoutingSetupBySessionId = new Map<string, Promise<boolean>>();
const childRoutingInProgress = new Map<string, Promise<boolean>>();
const childSessionsAwaitingIdleCleanup = new Set<string>();
const childTopicDeletionBlockedSessions = new Set<string>();
const childTopicPromptSent = new Set<string>();
const childReasoningBuffer = new Map<string, { messageId: string; text: string }>();
const childTypingIntervals = new Map<string, ReturnType<typeof setInterval>>();
const childSessionTitle = new Map<string, string>();
const childTopicLastSetName = new Map<string, string>();

export function setChildTopicLastSetName(sessionId: string, name: string): void {
  childTopicLastSetName.set(sessionId, name);
}

export function getChildTopicLastSetName(sessionId: string): string | undefined {
  return childTopicLastSetName.get(sessionId);
}

interface ChildSessionMeta {
  agent: string;
  providerID: string;
  modelID: string;
  startTime: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

const childSessionMeta = new Map<string, ChildSessionMeta>();
const subagentTokensByParent = new Map<string, { input: number; output: number }>();
const childTopicPinnedMessageId = new Map<string, number>();

// 2026-05-01: Tracks the maternal session's own token usage from completionInfo,
// used in the maternal idle footer to show maternal + sum(child) tokens.
const maternalTokenUsage = new Map<string, { input: number; output: number }>();
const publishedToolDetailCallIds = new Set<string>();

interface ChildAssistantMessageState {
  orderedPartIds: string[];
  partTexts: Map<string, string>;
  delivered: boolean;
  pendingDeletionTerminalStatus?: string;
}

const childAssistantMessagesBySessionId = new Map<
  string,
  Map<string, ChildAssistantMessageState>
>();
const childSessionLastMessage = new Map<string, string>();

function isManagedChildSession(sessionId: string): boolean {
  return managedChildSessionIds.has(sessionId);
}

function clearChildAssistantSession(sessionId: string): void {
  childAssistantMessagesBySessionId.delete(sessionId);
  childSessionLastMessage.delete(sessionId);
  pendingChildRoutingSetupBySessionId.delete(sessionId);
  childSessionsAwaitingIdleCleanup.delete(sessionId);
  childTopicDeletionBlockedSessions.delete(sessionId);
  childTopicPromptSent.delete(sessionId);
  childSessionMeta.delete(sessionId);
  childSessionTitle.delete(sessionId);
  childTopicLastSetName.delete(sessionId);
  childReasoningBuffer.delete(sessionId);
  const typingInterval = childTypingIntervals.get(sessionId);
  if (typingInterval) {
    clearInterval(typingInterval);
    childTypingIntervals.delete(sessionId);
  }
  managedChildSessionIds.delete(sessionId);
}

function setChildAssistantTextPart(
  sessionId: string,
  messageId: string,
  partId: string,
  text: string,
): void {
  const messages =
    childAssistantMessagesBySessionId.get(sessionId) ??
    new Map<string, ChildAssistantMessageState>();
  if (!childAssistantMessagesBySessionId.has(sessionId)) {
    childAssistantMessagesBySessionId.set(sessionId, messages);
  }

  const existing = messages.get(messageId) ?? {
    orderedPartIds: [],
    partTexts: new Map<string, string>(),
    delivered: false,
  };

  if (!messages.has(messageId)) {
    messages.set(messageId, existing);
  }

  if (!existing.partTexts.has(partId)) {
    existing.orderedPartIds.push(partId);
  }

  existing.partTexts.set(partId, text);
}

function markChildAssistantDelivered(sessionId: string, messageId: string): boolean {
  const state = childAssistantMessagesBySessionId.get(sessionId)?.get(messageId);
  if (!state || state.delivered) {
    return false;
  }

  state.delivered = true;
  return true;
}

function getCombinedChildAssistantText(sessionId: string, messageId: string): string {
  const state = childAssistantMessagesBySessionId.get(sessionId)?.get(messageId);
  if (!state) {
    return "";
  }

  return state.orderedPartIds
    .map((partId) => state.partTexts.get(partId) ?? "")
    .filter((partText) => partText.length > 0)
    .join("");
}

async function confirmChildTopicFinalDelivery(sessionId: string): Promise<void> {
  if (childTopicDeletionBlockedSessions.has(sessionId)) {
    return;
  }

  const autoDeleteMinutes = await runWithTelegramConversationScope(
    getSessionRoutingScope(sessionId),
    () => getSubagentTopicAutoDeleteMinutes(),
  );
  subagentTopicService.confirmFinalDelivery(sessionId, autoDeleteMinutes);
}

async function deliverChildTopicTerminalFooterAndConfirmDelivery(
  sessionId: string,
  terminalStatus: string,
): Promise<void> {
  if (childTopicDeletionBlockedSessions.has(sessionId)) {
    return;
  }

  const lifecycle = subagentTopicService.getLifecycleStateForSession(sessionId);
  if (!lifecycle || lifecycle.finalDeliveryConfirmed) {
    return;
  }

  const effectiveTerminalStatus = lifecycle.terminalStatus ?? terminalStatus;
  if (!lifecycle.terminalStatus) {
    subagentTopicService.markTerminalStatus(sessionId, effectiveTerminalStatus);
  }

  try {
    const meta = childSessionMeta.get(sessionId);
    if (meta) {
      const elapsedMs = Date.now() - meta.startTime;
      await deliverChildTopicMessage(childTopicDeliveryDependencies, {
        sessionId,
        kind: "terminal_footer",
        text: formatAssistantRunFooter({
          agent: meta.agent,
          providerID: meta.providerID,
          modelID: meta.modelID,
          elapsedMs,
          inputTokens: meta.tokens.input,
          outputTokens: meta.tokens.output,
        }),
        format: "html",
      });
    }

    await confirmChildTopicFinalDelivery(sessionId);
  } catch (error) {
    subagentTopicService.markDeliveryCleanupPending(sessionId, effectiveTerminalStatus);
    throw error;
  }
}

function shouldPreserveChildCleanupState(sessionId: string): boolean {
  if (childTopicDeletionBlockedSessions.has(sessionId)) {
    return true;
  }

  const lifecycle = subagentTopicService.getLifecycleStateForSession(sessionId);
  return lifecycle?.lifecycleState === "cleanup_pending" && !lifecycle.finalDeliveryConfirmed;
}

function hasPendingChildAssistantDelivery(sessionId: string): boolean {
  const sessionMessages = childAssistantMessagesBySessionId.get(sessionId);
  if (!sessionMessages) {
    return false;
  }

  return [...sessionMessages.values()].some((state) => !state.delivered);
}

async function scheduleChildTopicDeletionWhenDeliveryCompletes(
  sessionId: string,
  terminalStatus: string,
): Promise<void> {
  const lifecycle = subagentTopicService.getLifecycleStateForSession(sessionId);
  if (lifecycle?.finalDeliveryConfirmed) {
    return;
  }

  const sessionMessages = childAssistantMessagesBySessionId.get(sessionId);
  if (!sessionMessages || sessionMessages.size === 0) {
    await deliverChildTopicTerminalFooterAndConfirmDelivery(sessionId, terminalStatus);
    return;
  }

  let markedPending = false;
  for (const state of sessionMessages.values()) {
    if (!state.delivered) {
      state.pendingDeletionTerminalStatus = terminalStatus;
      markedPending = true;
    }
  }

  if (markedPending) {
    subagentTopicService.markTerminalStatus(sessionId, terminalStatus);
    return;
  }

  await deliverChildTopicTerminalFooterAndConfirmDelivery(sessionId, terminalStatus);
}
function setSessionRoutingContext(sessionId: string, routing: SessionRoutingContext): void {
  routingBySessionId.set(sessionId, routing);
}

function syncSessionRoutingContext(sessionId: string): SessionRoutingContext | null {
  const promptRouting = getPromptRoutingContext(sessionId);
  if (!promptRouting) {
    // When there is no active prompt routing (e.g. background SSE events,
    // questions, permissions for a session that was re-attached to a different
    // topic), we must still sync from AttachManager.  Without this the stale
    // routingBySessionId cache wins and getSessionDeliveryTarget() returns a
    // target that may point to the wrong forum topic.
    const attachedScope = attachManager.getScopeForSession(sessionId);
    if (attachedScope) {
      const attachedTarget = attachManager.getTargetForSession(sessionId);
      if (attachedTarget) {
        return commitSyncedRouting(sessionId, {
          botSource: "attached",
          target: attachedTarget,
          scope: attachedScope,
        });
      }
    }

    const cached = routingBySessionId.get(sessionId);
    if (cached) {
      return cached;
    }

    // Recovery after restart: attachManager and promptRouting are in-memory and lost.
    // Try to find the session's last known scope from the persistent active-session tracker.
    const recovery = tryRecoverRoutingFromActiveSession(sessionId);
    if (recovery) {
      return recovery;
    }

    return null;
  }

  const attachedScope = attachManager.getScopeForSession(sessionId);
  const attachedTarget = attachedScope ? attachManager.getTargetForSession(sessionId) : null;

  // attachedTarget comes from attachManager.buildTarget(scope) which uses
  // extractTelegramConversationScopeFromContext — that strips messageThreadId
  // for non-forum chats (private chats with topics are not supergroup forums).
  // When attachedTarget lacks messageThreadId but promptRouting.target has one,
  // merge the thread ID so replies land in the correct topic.
  const effectiveTarget = attachedTarget
    ? (attachedTarget.messageThreadId !== undefined
        ? attachedTarget
        : (promptRouting.target.messageThreadId !== undefined
            ? { ...attachedTarget, messageThreadId: promptRouting.target.messageThreadId }
            : attachedTarget))
    : promptRouting.target;

  const routing: SessionRoutingContext = {
    bot: promptRouting.bot,
    target: effectiveTarget,
    deliveryTarget: effectiveTarget,
    scope: attachedScope ?? promptRouting.scope,
    targetSource: attachedTarget ? "attached" : "prompt",
    sourceMessageId: promptRouting.sourceMessageId,
  };

  logger.info(
    `[Routing] syncSessionRoutingContext: session=${sessionId.slice(0, 8)} ` +
    `target.chatId=${routing.target.chatId} target.threadId=${routing.target.messageThreadId ?? "none"} ` +
    `deliveryTarget.threadId=${routing.deliveryTarget?.messageThreadId ?? "none"} ` +
    `source=${routing.targetSource} ` +
    `isForum=${promptRouting.isForumChat}`,
  );

  setSessionRoutingContext(sessionId, routing);
  return routing;
}

function commitSyncedRouting(
  sessionId: string,
  opts: {
    botSource: "attached" | "prompt" | "recovery";
    target: TelegramThreadTarget;
    deliveryTarget?: TelegramThreadTarget;
    scope: TelegramConversationScope | null;
    sourceMessageId?: number;
  },
): SessionRoutingContext | null {
  const existingRouting = routingBySessionId.get(sessionId);
  const bot = existingRouting?.bot ?? activeBotInstance;
  if (!bot) {
    return null;
  }

  const routing: SessionRoutingContext = {
    bot,
    target: opts.target,
    deliveryTarget: opts.deliveryTarget ?? opts.target,
    scope: opts.scope,
    targetSource: opts.botSource,
    sourceMessageId: opts.sourceMessageId ?? existingRouting?.sourceMessageId,
  };

  setSessionRoutingContext(sessionId, routing);
  return routing;
}

function tryRecoverRoutingFromActiveSession(sessionId: string): SessionRoutingContext | null {
  const entry = findActiveSessionById(sessionId);
  if (!entry) {
    return null;
  }

  const recoveryTarget: TelegramThreadTarget = entry.messageThreadId
    ? { chatId: entry.chatId, messageThreadId: entry.messageThreadId }
    : { chatId: entry.chatId };

  const recoveryScope: TelegramConversationScope = {
    userId: entry.chatId,
    chatId: entry.chatId,
    messageThreadId: entry.messageThreadId ?? undefined,
  };

  logger.info(
    `[Routing] recovery after restart: session=${sessionId.slice(0, 8)} ` +
    `chatId=${entry.chatId} threadId=${entry.messageThreadId ?? "none"} ` +
    `source=recovery`,
  );

  return commitSyncedRouting(sessionId, {
    botSource: "recovery",
    target: recoveryTarget,
    scope: recoveryScope,
  });
}

async function tryAutoCreateSessionTopic(
  sessionId: string,
  userId: number,
  session: { id: string; title: string; directory: string },
): Promise<boolean> {
  const existing = routingBySessionId.get(sessionId);
  if (existing) {
    return true;
  }

  const forumChatId = threadContextManager.findForumChatIdForUser(userId);
  if (!forumChatId) {
    return false;
  }

  if (!activeBotInstance) {
    return false;
  }

  try {
    const topicName = session.title.trim() || "Session";
    const createResult = await activeBotInstance.api.createForumTopic(forumChatId, topicName);

    const messageThreadId =
      (createResult as { message_thread_id?: number }).message_thread_id ??
      (createResult as { messageThreadId?: number }).messageThreadId ??
      0;

    if (!messageThreadId) {
      return false;
    }

    const scope: TelegramConversationScope = {
      userId,
      chatId: forumChatId,
      messageThreadId,
    };

    attachManager.attach(scope, session);

    setSessionRoutingContext(sessionId, {
      bot: activeBotInstance,
      target: { chatId: forumChatId, messageThreadId },
      deliveryTarget: { chatId: forumChatId, messageThreadId },
      scope,
      targetSource: "attached",
    });

    logger.info(
      `[Routing] auto-created forum topic for web session: session=${sessionId.slice(0, 8)} ` +
      `chatId=${forumChatId} threadId=${messageThreadId}`,
    );

    return true;
  } catch (err) {
    logger.warn(`[Routing] failed to auto-create topic for web session ${sessionId.slice(0, 8)}`, err);
    return false;
  }
}

function getSessionRoutingContext(sessionId: string): SessionRoutingContext | null {
  const routing = routingBySessionId.get(sessionId);
  if (routing) {
    return routing;
  }

  return syncSessionRoutingContext(sessionId);
}

function clearSessionRoutingContext(sessionId: string): void {
  const scopeKey = getSessionRoutingScopeKey(sessionId);
  if (scopeKey) {
    unregisterPermissionSendFn(scopeKey);
  }
  routingBySessionId.delete(sessionId);
  clearPromptRouting(sessionId);
}

function getCurrentReplyKeyboard() {
  if (!keyboardManager.isInitialized()) {
    return undefined;
  }

  return keyboardManager.getKeyboard();
}

function resolveAttachedSessionTarget(sessionId: string) {
  return (
    attachManager.getTargetForSession(sessionId) ?? threadContextManager.getSessionTarget(sessionId)
  );
}

function hasLiveSessionTarget(sessionId: string): boolean {
  return resolveAttachedSessionTarget(sessionId) != null;
}

function getSessionRoutingTarget(sessionId: string) {
  const attachedTarget = resolveAttachedSessionTarget(sessionId);
  if (attachedTarget) {
    // attachedTarget comes from attachManager.getTargetForSession which strips
    // messageThreadId for non-forum chats.  When prompt routing carries a
    // valid thread ID, merge it so thinking and final-response deliveries
    // land in the correct topic.
    if (attachedTarget.messageThreadId === undefined) {
      const routingTarget = getSessionRoutingContext(sessionId)?.target;
      if (routingTarget?.messageThreadId !== undefined) {
        return { ...attachedTarget, messageThreadId: routingTarget.messageThreadId };
      }
    }
    return attachedTarget;
  }
  return getSessionRoutingContext(sessionId)?.target;
}

function getSessionDeliveryTarget(sessionId: string): TelegramDeliveryTarget | null {
  const routing = getSessionRoutingContext(sessionId);
  if (routing?.deliveryTarget) {
    return routing.deliveryTarget;
  }

  const target = getSessionRoutingTarget(sessionId);
  return target ? { ...target } : null;
}

function getSessionRoutingApi(sessionId: string) {
  const routing = getSessionRoutingContext(sessionId);
  if (routing) {
    return routing.bot.api;
  }

  return activeBotInstance?.api ?? null;
}

function getSessionRoutingScope(sessionId: string): TelegramConversationScope | null {
  const routing = getSessionRoutingContext(sessionId);
  if (routing) {
    return routing.scope;
  }

  return (
    attachManager.getScopeForSession(sessionId) ?? threadContextManager.getSessionScope(sessionId)
  );
}

function getSessionRoutingScopeKey(sessionId: string): string {
  return buildTelegramConversationScopeKey(getSessionRoutingScope(sessionId));
}

const childTopicDeliveryDependencies = {
  getRoutingApi: getSessionRoutingApi,
  getDeliveryTarget: getSessionDeliveryTarget,
  withTopicReopenClose: async <T>(_sessionId: string, fn: () => Promise<T>): Promise<T> =>
    await fn(),
  sendText: sendBotText,
};

function cloneRoutingContextForChildSession(options: {
  parentSessionId: string;
  childSessionId: string;
  target: { chatId: number; messageThreadId?: number };
  deliveryTarget?: TelegramDeliveryTarget | null;
}): boolean {
  const parentScope = getSessionRoutingScope(options.parentSessionId);
  const parentRouting = getSessionRoutingContext(options.parentSessionId);
  if (!parentRouting) {
    return false;
  }

  setSessionRoutingContext(options.childSessionId, {
    bot: parentRouting.bot,
    target: options.target,
    deliveryTarget: options.deliveryTarget ?? options.target,
    scope: routeTargetToScope(parentScope, options.target),
    targetSource: parentRouting.targetSource,
    sourceMessageId: parentRouting.sourceMessageId,
  });

  managedChildSessionIds.add(options.childSessionId);

  return true;
}

function seedChildRoutingFromSubagent(options: {
  parentSessionId: string;
  childSessionId: string;
  topicName: string;
}): boolean {
  const existingScope = subagentTopicService.getScopeForSession(options.childSessionId);
  if (existingScope?.kind === "topic") {
    return true;
  }

  const parentTarget = getSessionRoutingTarget(options.parentSessionId);
  if (!parentTarget) {
    return false;
  }

  const cloned = cloneRoutingContextForChildSession({
    parentSessionId: options.parentSessionId,
    childSessionId: options.childSessionId,
    target: {
      chatId: parentTarget.chatId,
      messageThreadId: parentTarget.messageThreadId,
    },
    deliveryTarget: {
      chatId: parentTarget.chatId,
      messageThreadId: parentTarget.messageThreadId,
    },
  });

  return cloned;
}

function routeTargetToScope(
  parentScope: TelegramConversationScope | null,
  target: { chatId: number; messageThreadId?: number },
): TelegramConversationScope | null {
  if (!parentScope) {
    return null;
  }

  return {
    userId: parentScope.userId,
    chatId: target.chatId,
    ...(target.messageThreadId === undefined ? {} : { messageThreadId: target.messageThreadId }),
  };
}

function getBusyScopeForSession(sessionId: string): TelegramConversationScope | null {
  return getSessionRoutingScope(sessionId);
}

function isForumScope(scope: TelegramConversationScope | null): boolean {
  return typeof scope?.messageThreadId === "number";
}

function isForumParentSession(sessionId: string): boolean {
  const promptRouting = getPromptRoutingContext(sessionId);
  if (promptRouting) {
    return promptRouting.isForumChat;
  }

  return isForumScope(getSessionRoutingScope(sessionId));
}

async function syncSubagentDeliveryContextForSession(options: {
  childSessionId: string;
  parentSessionId: string;
  topicName: string;
  promptMessage?: string;
}): Promise<boolean> {
  const parentPromptRouting = getPromptRoutingContext(options.parentSessionId);
  const parentRouting =
    routingBySessionId.get(options.parentSessionId) ??
    (parentPromptRouting
      ? {
          bot: parentPromptRouting.bot,
          target: parentPromptRouting.target,
          deliveryTarget: parentPromptRouting.target,
          scope: parentPromptRouting.scope,
          targetSource: "prompt" as const,
          sourceMessageId: parentPromptRouting.sourceMessageId,
        }
      : null);
  const parentScope =
    parentRouting?.scope ?? parentPromptRouting?.scope ?? threadContextManager.getActiveScope();
  const parentTarget =
    parentRouting?.target ??
    parentPromptRouting?.target ??
    resolveAttachedSessionTarget(options.parentSessionId) ??
    threadContextManager.getSessionTarget(options.parentSessionId);
  const parentBot = parentRouting?.bot ?? parentPromptRouting?.bot ?? activeBotInstance;
  if (!parentScope || !parentTarget || !parentBot) {
    return false;
  }

  const topicsEnabled = await runWithTelegramConversationScope(parentScope, () =>
    getSubagentTopicsEnabled(),
  );
  if (!topicsEnabled) {
    return false;
  }

  const isForum = parentPromptRouting?.isForumChat ?? isForumParentSession(options.parentSessionId);
  const botHasTopicsInPrivate = activeBotInstance?.botInfo?.has_topics_enabled === true;
  let effectiveIsForum = isForum || botHasTopicsInPrivate;
  let subagentChatId = parentTarget.chatId;

  if (!isForum && botHasTopicsInPrivate) {
    const forumChatId = threadContextManager.findForumChatIdForUser(parentScope.userId);
    if (forumChatId) {
      subagentChatId = forumChatId;
    } else {
      effectiveIsForum = false;
    }
  }

  const topicScope = await subagentTopicService.syncSubagent({
    childSessionId: options.childSessionId,
    topicName: options.topicName,
    parent: {
      chatId: subagentChatId,
      isForum: effectiveIsForum,
    },
  });

  const topicTarget = subagentTopicService.getTargetForSession(options.childSessionId);
  if (!topicTarget || topicScope.kind !== "topic") {
    return false;
  }

  setSessionRoutingContext(options.childSessionId, {
    bot: parentBot,
    target: {
      chatId: topicTarget.chatId,
      messageThreadId: topicTarget.messageThreadId,
    },
    deliveryTarget: topicTarget,
    scope: routeTargetToScope(parentScope, topicTarget),
    targetSource: parentRouting?.targetSource ?? "prompt",
    sourceMessageId: parentRouting?.sourceMessageId ?? parentPromptRouting?.sourceMessageId,
  });

  managedChildSessionIds.add(options.childSessionId);

  if (options.promptMessage && !childTopicPromptSent.has(options.childSessionId)) {
    childTopicPromptSent.add(options.childSessionId);

    safeBackgroundTask({
      taskName: `subagent-topic-initial-msg.${options.childSessionId}`,
      task: async () => {
        try {
          const sent = await parentBot.api.sendMessage(topicTarget.chatId, options.promptMessage!, {
            message_thread_id: topicTarget.messageThreadId,
            parse_mode: "HTML",
            disable_notification: true,
          });

          childTopicPinnedMessageId.set(options.childSessionId, sent.message_id);

          logger.debug("[Bot] Pinning subagent topic", {
            childSessionId: options.childSessionId,
            chatId: topicTarget.chatId,
            messageId: sent.message_id,
            messageThreadId: topicTarget.messageThreadId,
          });

          try {
            await parentBot.api.pinChatMessage(topicTarget.chatId, sent.message_id, {
              disable_notification: true,
            });
            logger.debug("[Bot] Subagent topic pinned successfully", {
              childSessionId: options.childSessionId,
            });
          } catch (pinError) {
            logger.warn("[Bot] Failed to pin subagent topic message", {
              childSessionId: options.childSessionId,
              chatId: topicTarget.chatId,
              messageId: sent.message_id,
              messageThreadId: topicTarget.messageThreadId,
              error: String(pinError),
            });
          }
        } catch (error) {
          logger.warn("[Bot] Failed to send initial subagent prompt message to topic", {
            childSessionId: options.childSessionId,
            error,
          });
        }
      },
    });
  }

  return true;
}

async function syncSubagentDeliverySerialized(options: {
  childSessionId: string;
  parentSessionId: string;
  topicName: string;
  promptMessage?: string;
}): Promise<boolean> {
  const existing = childRoutingInProgress.get(options.childSessionId);
  if (existing) {
    return existing;
  }

  const promise = syncSubagentDeliveryContextForSession(options).catch(() => false);
  childRoutingInProgress.set(options.childSessionId, promise);

  try {
    return await promise;
  } finally {
    if (childRoutingInProgress.get(options.childSessionId) === promise) {
      childRoutingInProgress.delete(options.childSessionId);
    }
  }
}

function buildThinkingRoutingIdentity(target: {
  chatId: number;
  messageThreadId?: number;
}): string {
  return `${target.chatId}:${target.messageThreadId ?? "main"}`;
}

function renderChildAssistantFinalParts(
  text: string,
  format: "raw" | "markdown_v2",
): TelegramRenderedPart[] {
  if (format === "markdown_v2" && config.bot.messageFormatMode === "markdown") {
    return renderAssistantFinalPartsSafe(text, RESPONSE_STREAM_TEXT_LIMIT);
  }

  return createPlainRenderedParts(text, RESPONSE_STREAM_TEXT_LIMIT);
}

function deriveSubagentTopicNameFromSessionTitle(title?: string): string {
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    return "Subagent";
  }

  const match = trimmedTitle.match(/^(.*?)(?:\s+\(@[^\s)]+\s+subagent\))?$/i);
  return match?.[1]?.trim() || trimmedTitle;
}

function createDeferredValue<T>(): DeferredValue<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function buildToolPublicationLogicalMessageId(toolInfo: {
  messageId: string;
  callId: string;
}): string {
  return `tool:${toolInfo.messageId}:${toolInfo.callId}`;
}

function buildSubagentPublicationLogicalMessageId(sessionId: string): string {
  return `subagent:${sessionId}`;
}

function queueOrderedPublication(
  sessionId: string,
  publication: OrderedPublicationInfo,
  deliver: () => Promise<void>,
): Promise<void> {
  return finalAssistantDeliveryOrchestrator.enqueue({
    sessionId,
    channel: "durable",
    eventTimeMs: publication.eventTimeMs,
    logicalMessageId: publication.logicalMessageId,
    deliver,
  });
}

function scheduleOrderedPublication(
  sessionId: string,
  publication: OrderedPublicationInfo,
): DeferredValue<(() => Promise<void>) | null> {
  const deferredDelivery = createDeferredValue<(() => Promise<void>) | null>();
  void queueOrderedPublication(sessionId, publication, async () => {
    const deliver = await deferredDelivery.promise;
    if (deliver) {
      await deliver();
    }
  }).catch(() => undefined);
  void finalAssistantDeliveryOrchestrator.flushSession(sessionId).catch((error) => {
    logger.warn(`[Bot] Ordered publication flush failed: session=${sessionId}`, error);
  });
  return deferredDelivery;
}

function isSessionRoutingLiveAttached(sessionId: string): boolean {
  return getSessionRoutingContext(sessionId)?.targetSource === "attached";
}

async function runWithSessionRoutingScope<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  return await runWithTelegramConversationScope(getSessionRoutingScope(sessionId), fn);
}

async function getReplyKeyboardForSession(sessionId: string) {
  return await runWithSessionRoutingScope(sessionId, async () => getCurrentReplyKeyboard());
}

function enqueueSessionCompletionTask(sessionId: string, task: () => Promise<void>): Promise<void> {
  const previousTask = sessionCompletionTasks.get(sessionId) ?? Promise.resolve();
  const nextTask = previousTask
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (sessionCompletionTasks.get(sessionId) === nextTask) {
        sessionCompletionTasks.delete(sessionId);
      }
    });

  sessionCompletionTasks.set(sessionId, nextTask);
  return nextTask;
}

function getReasoningModeForSession(sessionId: string) {
  return runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () =>
    getReasoningMode(),
  );
}

function isMessageStreamingEnabledForSession(sessionId: string): boolean {
  return runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () =>
    isMessageStreamingEnabled(),
  );
}

interface SessionIdleHandlingOptions {
  skipPendingCompletionWait?: boolean;
}

async function getHideThinkingMessagesForSession(sessionId: string): Promise<boolean> {
  return await runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () =>
    getHideThinkingMessages(),
  );
}

async function getHideToolCallMessagesForSession(sessionId: string): Promise<boolean> {
  return await runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () =>
    getHideToolCallMessages(),
  );
}

async function getHideToolFileMessagesForSession(sessionId: string): Promise<boolean> {
  return await runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () =>
    getHideToolFileMessages(),
  );
}

function isSessionCurrent(sessionId: string): boolean {
  const routing = getSessionRoutingContext(sessionId);
  const deliveryTarget = getSessionDeliveryTarget(sessionId);
  if (getSessionRoutingApi(sessionId) === null) {
    return false;
  }

  if (!routing) {
    return hasLiveSessionTarget(sessionId);
  }

  if (routing.targetSource === "prompt") {
    return true;
  }

  if (deliveryTarget?.disableNotification) {
    return true;
  }

  return hasLiveSessionTarget(sessionId);
}

function prepareDocumentCaption(caption: string): string {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    return "";
  }

  if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
    return normalizedCaption;
  }

  return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
}

interface TelegramMediaApi {
  sendPhoto: Bot<Context>["api"]["sendPhoto"];
  sendAudio: Bot<Context>["api"]["sendAudio"];
  sendVideo: Bot<Context>["api"]["sendVideo"];
  sendDocument: Bot<Context>["api"]["sendDocument"];
}

interface LocalFileFollowUpDeliveryRoute {
  api: TelegramMediaApi;
  target: TelegramDeliveryTarget;
  routingIdentity: string;
}

interface SessionLocalFilePathAccess {
  resolvePath: (filePath: string) => string | null;
  isAllowed?: (resolvedPath: string) => Promise<boolean> | boolean;
}

function resolveTenantContainerPath(params: {
  filePath: string;
  containerRoot: string;
  hostRoot: string;
}): string | null {
  if (
    params.filePath !== params.containerRoot &&
    !params.filePath.startsWith(`${params.containerRoot}/`)
  ) {
    return null;
  }

  const relativePath = path.posix.relative(params.containerRoot, params.filePath);
  if (relativePath.startsWith("..") || path.posix.isAbsolute(relativePath)) {
    return null;
  }

  const resolvedPath =
    relativePath === "" || relativePath === "."
      ? path.resolve(params.hostRoot)
      : path.resolve(params.hostRoot, relativePath);
  const resolvedRoot = path.resolve(params.hostRoot);

  return isPathInsideRoot(resolvedPath, resolvedRoot) ? resolvedPath : null;
}

function getSessionLocalFilePathResolver(
  sessionId: string,
): SessionLocalFilePathAccess | undefined {
  const scope = getSessionRoutingScope(sessionId);
  if (!scope || scope.userId === config.telegram.adminUserId) {
    return undefined;
  }

  const tenantRuntime = getTenantRuntimeInfo(scope.userId);
  if (!tenantRuntime?.tenantId) {
    return undefined;
  }

  const workspacesRoot = process.env.WORKSPACES_ROOT || "/home/me/Workspaces";
  const tenantRoot = path.join(workspacesRoot, tenantRuntime.tenantId);
  const tenantStateRoot = path.join(tenantRoot, "state");
  const tenantWorkspaceRoot = path.join(tenantRoot, "workspace");

  return {
    resolvePath: (filePath: string): string | null => {
      return (
        resolveTenantContainerPath({
          filePath,
          containerRoot: "/state",
          hostRoot: tenantStateRoot,
        }) ??
        resolveTenantContainerPath({
          filePath,
          containerRoot: "/workspace",
          hostRoot: tenantWorkspaceRoot,
        })
      );
    },
    isAllowed: async (resolvedPath: string): Promise<boolean> => {
      // 2026-04-30: tenant users may only receive files whose canonical target
      // remains inside their mapped roots. This blocks raw host paths, `..`
      // traversal, and symlink escapes before Telegram opens the file.
      return (
        (await isRealPathInsideRoot(resolvedPath, tenantStateRoot).catch(() => false)) ||
        (await isRealPathInsideRoot(resolvedPath, tenantWorkspaceRoot).catch(() => false))
      );
    },
  };
}

async function sendPreparedLocalFileFollowUp(
  api: TelegramMediaApi,
  target: TelegramDeliveryTarget,
  followUp: PreparedLocalFileFollowUp,
): Promise<void> {
  // Что делает этот код:
  // - выбирает правильный Telegram media method по уже подготовленному kind,
  // - отправляет локальный файл отдельным follow-up сообщением,
  // - использует HTML monospace caption для безопасного показа пути.
  // Почему выбрано это решение:
  // - routing типа медиа должен быть централизован и предсказуем,
  //   а подпись должна быть одинаковой для photo/audio/video/document.
  // Исправлено:
  // - вместо QR-only follow-up появился общий media follow-up для локальных файлов.
  // Цель:
  // - отправлять изображения, аудио и видео в нативном Telegram формате.
  const inputFile = new InputFile(followUp.resolvedPath ?? followUp.path);
  const options = withMessageThreadId(
    {
      caption: followUp.caption,
      parse_mode: "HTML" as const,
      disable_notification: true,
    },
    target.messageThreadId,
  );

  if (followUp.kind === "photo") {
    await api.sendPhoto(target.chatId, inputFile, options);
    return;
  }

  if (followUp.kind === "audio") {
    await api.sendAudio(target.chatId, inputFile, options);
    return;
  }

  if (followUp.kind === "video") {
    await api.sendVideo(target.chatId, inputFile, options);
    return;
  }

  await api.sendDocument(target.chatId, inputFile, options);
}

async function enqueueLocalFileFollowUpsFromText(sessionId: string, text: string): Promise<void> {
  if (!text.trim()) {
    return;
  }

  const botApi = getSessionRoutingApi(sessionId);
  const target = getSessionDeliveryTarget(sessionId);
  if (!botApi || !target || !isSessionCurrent(sessionId)) {
    return;
  }

  const deliveryRoute: LocalFileFollowUpDeliveryRoute = {
    api: botApi,
    target,
    routingIdentity: buildThinkingRoutingIdentity(target),
  };

  const reservedPaths = localFileFollowUpTracker.reserve(sessionId, extractLocalFilePaths(text));
  if (reservedPaths.length === 0) {
    return;
  }

  const localFilePathAccess = getSessionLocalFilePathResolver(sessionId);
  const preparedFollowUps = await prepareLocalFileFollowUpsFromPaths(
    reservedPaths,
    localFilePathAccess?.resolvePath,
    localFilePathAccess?.isAllowed,
  );
  if (preparedFollowUps.length === 0) {
    localFileFollowUpTracker.release(sessionId, reservedPaths);
    return;
  }

  const preparedPaths = new Set(preparedFollowUps.map((followUp) => followUp.path));
  const unusedPaths = reservedPaths.filter((filePath) => !preparedPaths.has(filePath));
  if (unusedPaths.length > 0) {
    localFileFollowUpTracker.release(sessionId, unusedPaths);
  }

  safeBackgroundTask({
    taskName: `telegram.local-file-follow-up.${sessionId}`,
    task: async () => {
      const sentPaths: string[] = [];
      try {
        for (const followUp of preparedFollowUps) {
          const currentTarget = resolveAttachedSessionTarget(sessionId);
          const currentRoutingIdentity = currentTarget
            ? buildThinkingRoutingIdentity(currentTarget)
            : null;

          // 2026-04-29: prompt-only fallback routes stay deliverable from cached routing,
          // but attach-first routes must stop once the live attached target disappears.
          const lostAttachedRoute =
            isSessionRoutingLiveAttached(sessionId) && currentRoutingIdentity === null;
          const switchedLiveRoute =
            currentRoutingIdentity !== null &&
            currentRoutingIdentity !== deliveryRoute.routingIdentity;
          if (!isSessionCurrent(sessionId) || lostAttachedRoute || switchedLiveRoute) {
            break;
          }

          await sendPreparedLocalFileFollowUp(deliveryRoute.api, deliveryRoute.target, followUp);
          sentPaths.push(followUp.path);
        }
      } finally {
        if (sentPaths.length > 0) {
          localFileFollowUpTracker.markSent(sessionId, sentPaths);
        }

        const unsentPaths = preparedFollowUps
          .map((followUp) => followUp.path)
          .filter((filePath) => !sentPaths.includes(filePath));
        if (unsentPaths.length > 0) {
          localFileFollowUpTracker.release(sessionId, unsentPaths);
        }
      }
    },
  });
}

function joinFollowUpCandidateTexts(...texts: Array<string | undefined>): string {
  return texts
    .map((text) => text?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function buildFollowUpCandidateText(messageText?: string, reasoningText?: string): string {
  return joinFollowUpCandidateTexts(messageText, reasoningText);
}

const toolMessageBatcher = new ToolMessageBatcher({
  intervalSeconds: config.bot.serviceMessagesIntervalSec,
  sendText: async (sessionId, text, format) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionDeliveryTarget(sessionId);
    if (!botApi || !target || !isSessionCurrent(sessionId)) {
      return;
    }

    const keyboard = await getReplyKeyboardForSession(sessionId);

    await sendBotText({
      api: botApi,
      chatId: target.chatId,
      text,
      format,
      messageThreadId: target.messageThreadId,
      options: {
        disable_notification: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      },
    });
  },
  sendFile: async (sessionId, fileData) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionDeliveryTarget(sessionId);
    if (!botApi || !target || !isSessionCurrent(sessionId)) {
      return;
    }

    const tempFilePath = path.join(TEMP_DIR, fileData.filename);

    try {
      logger.debug(
        `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes, session=${sessionId})`,
      );

      await fs.mkdir(TEMP_DIR, { recursive: true });
      await fs.writeFile(tempFilePath, fileData.buffer);

      const keyboard = await getReplyKeyboardForSession(sessionId);

      await botApi.sendDocument(
        target.chatId,
        new InputFile(tempFilePath),
        withMessageThreadId(
          {
            caption: fileData.caption,
            ...(fileData.captionFormat === "html" ? { parse_mode: "HTML" as const } : {}),
            disable_notification: true,
            ...(keyboard ? { reply_markup: keyboard } : {}),
          },
          target.messageThreadId,
        ),
      );
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  },
});
const localFileFollowUpTracker = createLocalFileFollowUpTracker();

const responseStreamer = new ResponseStreamer({
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
  sendText: async (sessionId, text, format, options) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    const deliveryTarget = getSessionDeliveryTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for streamed send");
    }

    const effectiveThreadId = deliveryTarget?.messageThreadId ?? target.messageThreadId;
    logger.info(
      `[Routing] responseStreamer.sendText: session=${sessionId.slice(0, 8)} ` +
      `chatId=${target.chatId} threadId=${effectiveThreadId ?? "none"} ` +
      `deliveryTarget.threadId=${deliveryTarget?.messageThreadId ?? "none"} ` +
      `target.threadId=${target.messageThreadId ?? "none"}`,
    );

    const messageId = await sendStreamedBotText({
      api: botApi,
      chatId: target.chatId,
      text,
      options,
      format,
      messageThreadId: effectiveThreadId,
      deliveryTarget,
      useHtmlFallback: true,
    });

    if (typeof messageId !== "number") {
      throw new Error("Streamed send did not return a Telegram message id");
    }

    return messageId;
  },
  editText: async (sessionId, messageId, text, format, options) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for streamed edit");
    }

    try {
      await sendStreamedBotText({
        api: botApi,
        chatId: target.chatId,
        messageId,
        text,
        options,
        format,
        useHtmlFallback: true,
      });
    } catch (error) {
      const errorParts: string[] = [];
      if (error instanceof Error) {
        errorParts.push(error.message);
      }
      if (typeof error === "object" && error !== null) {
        const desc = Reflect.get(error, "description");
        if (typeof desc === "string") {
          errorParts.push(desc);
        }
      }
      const errorMessage = errorParts.join(" ").toLowerCase();
      if (errorMessage.includes("message is not modified")) {
        return;
      }

      throw error;
    }
  },
  deleteText: async (sessionId, messageId) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for streamed delete");
    }

    await botApi.deleteMessage(target.chatId, messageId).catch((error) => {
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        errorMessage.includes("message to delete not found") ||
        errorMessage.includes("message identifier is not specified")
      ) {
        return;
      }

      throw error;
    });
  },
});

const sharedMessageDraftIdAllocator = new SequentialMessageDraftIdAllocator();

const messageDraftStreamManager = new MessageDraftStreamManager(
  RESPONSE_STREAM_THROTTLE_MS,
  sharedMessageDraftIdAllocator,
);
configureThinkingBlockDraftIdAllocator(sharedMessageDraftIdAllocator);
export { messageDraftStreamManager };

let telegraphKeyPool: TelegraphKeyPool | null = null;

const telegraphClient: MultiKeyClient | null = (() => {
  if (!config.telegraph?.enabled) return null;

  const keysRepo = getTelegraphKeysRepo();
  const bindingsRepo = getArticleBindingsRepo();
  const userId = config.telegram.adminUserId;
  const encryptionKeySource = config.telegraph.tokenEncryptionKey
    ? Buffer.from(config.telegraph.tokenEncryptionKey, "hex")
    : Buffer.from(String(config.telegram.adminUserId).padStart(64, "0").slice(0, 32));

  void ensureUserKeys(keysRepo, userId, config.telegraph, encryptionKeySource, config.telegraph.maxKeysPerUser);

  const pool = new TelegraphKeyPool();
  const keys = keysRepo.getAllByUser(userId);
  for (const key of keys) {
    try {
      const token = decryptToken(key.token_encrypted, encryptionKeySource);
      const client = new TelegraphClient({
        enabled: true,
        accessToken: token,
        authorName: config.telegraph.authorName,
        timeoutMs: config.telegraph.timeoutMs,
        maxChars: config.telegraph.maxChars,
        translateEnabled: config.telegraph.translateEnabled,
        translateApiUrl: config.telegraph.translateApiUrl,
        maxKeysPerUser: config.telegraph.maxKeysPerUser,
        tokenEncryptionKey: config.telegraph.tokenEncryptionKey,
      });
      pool.addKey(client, key.id);
    } catch (error) {
      logger.warn("[Bot] Failed to decrypt Telegraph key, skipping", { keyId: key.id, error });
    }
  }

  if (pool.size === 0) {
    if (config.telegraph.accessToken) {
      const fallbackClient = new TelegraphClient(config.telegraph);
      pool.addKey(fallbackClient, 0);
    } else {
      logger.warn("[Bot] No Telegraph keys available");
      return null;
    }
  }

  telegraphKeyPool = pool;
  return new MultiKeyClient(pool, bindingsRepo, config.telegraph, userId);
})();
const technicalDetailsPublisher = telegraphClient
  ? new TelegraphPublishQueue(telegraphClient)
  : new NoopDetailsPublisher();
const thinkingDetailsPublisher = telegraphClient
  ? new ThinkingTelegraphAccumulator(telegraphClient)
  : new NoopDetailsPublisher();
const subagentTelegraphLogger = telegraphClient
  ? new SubagentTelegraphLogger(telegraphClient)
  : null;
const fileDiffLogger = telegraphKeyPool
  ? new FileDiffLogger(telegraphKeyPool, getFileArchiveRepo())
  : null;

const toolCallStreamer = new ToolCallStreamer({
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
  sendText: async (sessionId, text) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for tool stream send");
    }

    if (!isSessionCurrent(sessionId)) {
      throw new Error(`Tool stream session mismatch for send: ${sessionId}`);
    }

    const sentMessage = await botApi.sendMessage(
      target.chatId,
      text,
      withMessageThreadId(
        {
          disable_notification: true,
          parse_mode: "HTML" as const,
        },
        target.messageThreadId,
      ),
    );

    return sentMessage.message_id;
  },
  editText: async (sessionId, messageId, text) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for tool stream edit");
    }

    if (!isSessionCurrent(sessionId)) {
      throw new Error(`Tool stream session mismatch for edit: ${sessionId}`);
    }

    try {
      await botApi.editMessageText(target.chatId, messageId, text, {
        parse_mode: "HTML",
      });
    } catch (error) {
      const errorParts: string[] = [];
      if (error instanceof Error) {
        errorParts.push(error.message);
      }
      if (typeof error === "object" && error !== null) {
        const desc = Reflect.get(error, "description");
        if (typeof desc === "string") {
          errorParts.push(desc);
        }
      }
      const errorMessage = errorParts.join(" ").toLowerCase();
      if (errorMessage.includes("message is not modified")) {
        return;
      }

      throw error;
    }
  },
  deleteText: async (sessionId, messageId) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for tool stream delete");
    }

    if (!isSessionCurrent(sessionId)) {
      throw new Error(`Tool stream session mismatch for delete: ${sessionId}`);
    }

    await botApi.deleteMessage(target.chatId, messageId).catch((error) => {
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        errorMessage.includes("message to delete not found") ||
        errorMessage.includes("message identifier is not specified")
      ) {
        return;
      }

      throw error;
    });
  },
});

async function ensureCommandsInitialized(ctx: Context, next: NextFunction): Promise<void> {
  if (!ctx.from || !ctx.chat) {
    await next();
    return;
  }

  const userId = ctx.from.id;
  const isAdmin = userId === config.telegram.adminUserId;
  const isAllowedUser =
    config.telegram.allowedUserIds.includes(userId) ||
    getApprovedTelegramUserIds().includes(userId);

  if (!isAdmin && !isAllowedUser) {
    await next();
    return;
  }

  try {
    await syncAuthorizedChatCommands(ctx.api, ctx.chat.id, ctx.chat.type, isAdmin);
    logger.debug(
      `[Bot] Commands initialized for user (chat_id=${ctx.chat.id}, isAdmin=${isAdmin})`,
    );
  } catch (err) {
    logger.error("[Bot] Failed to sync commands:", err);
  }

  await next();
}

export function createSendRenderedPart({
  botApi,
  chatId,
  sessionId,
  finalParseMode,
  messageThreadId,
  deliveryTarget,
}: {
  botApi: Api<RawApi>;
  chatId: number;
  sessionId: string;
  finalParseMode: "html" | "raw" | "markdown_v2";
  messageThreadId?: number;
  deliveryTarget?: TelegramDeliveryTarget | null;
}) {
  return async (
    part: TelegramRenderedPart,
    options?: {
      reply_markup?: unknown;
      disable_notification?: boolean;
    },
  ) => {
    const draftMessageId = messageDraftStreamManager.consumeLastSentMessageId(sessionId);
    if (draftMessageId) {
      await botApi.deleteMessage(chatId, draftMessageId).catch(() => {});
    }

    const replyOptions =
      routingBySessionId.get(sessionId)?.sourceMessageId && options?.reply_markup
        ? {
            ...options,
            reply_parameters: {
              message_id: routingBySessionId.get(sessionId)!.sourceMessageId,
              allow_sending_without_reply: true,
            },
          }
        : options;

    const baseOptions = replyOptions ?? {};
    const sendOptions = {
      ...baseOptions,
      ...(part.entities?.length ? { entities: part.entities } : {}),
    };

    const effectiveThreadId = deliveryTarget?.messageThreadId ?? messageThreadId;
    logger.info(
      `[Routing] createSendRenderedPart: session=${sessionId.slice(0, 8)} ` +
      `chatId=${chatId} effectiveThreadId=${effectiveThreadId ?? "none"} ` +
      `deliveryTarget.threadId=${deliveryTarget?.messageThreadId ?? "none"} messageThreadId=${messageThreadId ?? "none"}`,
    );

    await sendBotText({
      api: botApi,
      chatId,
      text: part.text,
      rawFallbackText: part.fallbackText,
      options: sendOptions as Parameters<typeof sendBotText>[0]["options"],
      format: finalParseMode,
      messageThreadId: effectiveThreadId,
      deliveryTarget,
      useHtmlFallback: true,
    });
  };
}

function formatShortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

function getBackgroundSessionLabel(notification: BackgroundSessionNotification): string {
  const title = notification.sessionTitle?.trim();
  if (title) {
    return title;
  }

  return t("background.session_fallback", { id: formatShortSessionId(notification.sessionId) });
}

function formatBackgroundSessionNotification(notification: BackgroundSessionNotification): string {
  const session = getBackgroundSessionLabel(notification);

  switch (notification.kind) {
    case "assistant_response":
      return t("background.assistant_response", { session });
    case "question_asked":
      return t("background.question_asked", { session });
    case "permission_asked":
      return t("background.permission_asked", { session });
  }
}

async function deliverBackgroundSessionNotification(
  notification: BackgroundSessionNotification,
): Promise<void> {
  if (!activeBotInstance) {
    return;
  }

  const scope = threadContextManager.getSessionScope(notification.sessionId);
  if (!scope) {
    logger.debug(
      `[BackgroundNotification] No scope found for session ${notification.sessionId}, skipping notification`,
    );
    return;
  }

  if (typeof scope.messageThreadId === "number" && scope.messageThreadId > 0) {
    logger.debug(
      `[BackgroundNotification] Session ${notification.sessionId} is bound to topic ${scope.messageThreadId}, skipping notification`,
    );
    return;
  }

  const recipientChatId = scope.userId;
  const openButton = buildBackgroundSessionOpenKeyboard(notification.sessionId);
  await activeBotInstance.api.sendMessage(
    recipientChatId,
    formatBackgroundSessionNotification(notification),
    { reply_markup: openButton },
  );
}

/**
 * After event stream reconnection, check if an assistant message completed
 * while the stream was down and deliver it to the user.
 * Uses session.messages() to find the latest completed assistant message.
 */







async function ensureEventSubscription(directory: string): Promise<void> {
  if (!directory) {
    logger.error("No directory found for event subscription");
    return;
  }

  summaryAggregator.setTypingIndicatorEnabled(true);
  backgroundSessionTracker.setDirectory(directory);
  backgroundSessionTracker.setOnNotification(deliverBackgroundSessionNotification);

  if (!config.bot.trackBackgroundSessions) {
    backgroundSessionTracker.clear();
  }
  summaryAggregator.setSessionDirectoryResolver((sessionId) =>
    threadContextManager.getSessionDirectory(sessionId),
  );
  summaryAggregator.setOnCleared(() => {
    toolMessageBatcher.clearAll("summary_aggregator_clear");
    toolCallStreamer.clearAll("summary_aggregator_clear");
    responseStreamer.clearAll("summary_aggregator_clear");
    messageDraftStreamManager.clearAll();
    finalAssistantDeliveryOrchestrator.clearAll();
    clearAllThinkingBlockStreams();
    localFileFollowUpTracker.clearAll();
    assistantRunState.clearAll("summary_aggregator_clear");
    managedChildSessionIds.clear();
    childAssistantMessagesBySessionId.clear();
    pendingChildRoutingSetupBySessionId.clear();
    childSessionsAwaitingIdleCleanup.clear();
    childTopicDeletionBlockedSessions.clear();
    childTopicPromptSent.clear();
    subagentTopicService.clearAll();
    maternalTokenUsage.clear();
  });

  summaryAggregator.setOnPartial(
    async (sessionId, messageId, messageText, reasoningText, toolCalls) => {
      if (!isMessageStreamingEnabledForSession(sessionId)) {
        return;
      }

      syncSessionRoutingContext(sessionId);
      const botApi = getSessionRoutingApi(sessionId);
      const target = getSessionRoutingTarget(sessionId);
      const deliveryTarget = getSessionDeliveryTarget(sessionId);
      if (!botApi || !target) {
        return;
      }

      if (assistantRunState.isFinalResponsePublished(sessionId)) {
        return;
      }

      const mode = await getReasoningModeForSession(sessionId);
      if (!messageText.trim() && !reasoningText?.trim() && !toolCalls?.length) {
        return;
      }

      const hideThinkingMessages = await getHideThinkingMessagesForSession(sessionId);
      const visibleReasoningText = hideThinkingMessages
        ? undefined
        : getVisibleReasoningText(reasoningText);

      if (mode > 0 && visibleReasoningText) {
        try {
          const reasoningTitle = extractReasoningTitle(visibleReasoningText);
          const userLocalePartial = getTelegraphTranslateEnabled() ? getLocale() : undefined;
          const translatedTitlePartial = userLocalePartial && userLocalePartial !== "en"
            ? (await translateText(reasoningTitle, userLocalePartial).catch(() => null)) ?? reasoningTitle
            : reasoningTitle;
          await streamThinkingBlocks({
            sessionId,
            logicalMessageId: messageId,
            sendApi: botApi,
            target,
            title: translatedTitlePartial,
            reasoningText: visibleReasoningText,
          });
        } catch (error) {
          logger.warn(
            `[Bot] Thinking stream failed during partial delivery: session=${sessionId}, message=${messageId}`,
            error,
          );
        }
      }

      const assistantFormat = getAssistantParseMode() === "MarkdownV2" ? "markdown_v2" : "raw";

      messageDraftStreamManager.setSendEditApi(sessionId, botApi, botApi);
      const streamingMessageId = `${messageId}:assistant`;

      if (mode > 0) {
        if (messageText.trim()) {
          const payload =
            assistantFormat === "markdown_v2"
              ? prepareAssistantStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT)
              : null;
          responseStreamer.enqueue(sessionId, streamingMessageId, {
            parts: payload?.parts ?? [{ text: messageText }],
            format: payload?.format ?? assistantFormat,
            sendOptions: {
              disable_notification: true,
            },
            editOptions: undefined,
          });
        }
      } else {
        messageDraftStreamManager.enqueue(
          sessionId,
          botApi,
          deliveryTarget ?? target,
          messageText,
          assistantFormat,
        );
      }

      void enqueueLocalFileFollowUpsFromText(
        sessionId,
        buildFollowUpCandidateText(messageText, visibleReasoningText),
      );
    },
  );

  summaryAggregator.setOnComplete(
    async (sessionId, messageId, messageText, reasoningText, toolCalls, completionInfo) => {
      await enqueueSessionCompletionTask(sessionId, async () => {
        assistantRunState.markResponseCompleted(sessionId, completionInfo);

        // 2026-05-01: Track maternal session's own token usage for the idle footer.
        if (
          typeof completionInfo?.inputTokens === "number" ||
          typeof completionInfo?.outputTokens === "number"
        ) {
          const prev = maternalTokenUsage.get(sessionId) ?? { input: 0, output: 0 };
          maternalTokenUsage.set(sessionId, {
            input: Math.max(prev.input, completionInfo?.inputTokens ?? 0),
            output: Math.max(prev.output, completionInfo?.outputTokens ?? 0),
          });
        }

        if (!isSessionCurrent(sessionId)) {
          finalAssistantDeliveryOrchestrator.clearSession(sessionId);
          localFileFollowUpTracker.clearSession(sessionId);
          clearPromptResponseMode(sessionId);
          clearSessionRoutingContext(sessionId);
          messageDraftStreamManager.clearSession(sessionId);
          await clearThinkingBlockStream(sessionId, true);
          responseStreamer.clearMessage(sessionId, `${messageId}:assistant`, "session_mismatch");
          toolCallStreamer.clearSession(sessionId, "session_mismatch");
          assistantRunState.clearRun(sessionId, "session_mismatch");
          foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
          await scheduledTaskRuntime.flushDeferredDeliveries();
          return;
        }

        const botApi = getSessionRoutingApi(sessionId);
        const target = getSessionRoutingTarget(sessionId);
        if (!botApi || !target) {
          logger.error("Bot or chat ID not available for sending message");
          finalAssistantDeliveryOrchestrator.clearSession(sessionId);
          localFileFollowUpTracker.clearSession(sessionId);
          clearPromptResponseMode(sessionId);
          clearSessionRoutingContext(sessionId);
          messageDraftStreamManager.clearSession(sessionId);
          await clearThinkingBlockStream(sessionId, true);
          responseStreamer.clearMessage(sessionId, `${messageId}:assistant`, "bot_context_missing");
          toolMessageBatcher.clearSession(sessionId, "bot_context_missing");
          toolCallStreamer.clearSession(sessionId, "bot_context_missing");
          assistantRunState.clearRun(sessionId, "bot_context_missing");
          foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
          await scheduledTaskRuntime.flushDeferredDeliveries();
          return;
        }

        const chatId = target.chatId;
        const mode = await getReasoningModeForSession(sessionId);
        const hideThinkingMessages = await getHideThinkingMessagesForSession(sessionId);
        const visibleReasoningText = hideThinkingMessages
          ? undefined
          : getVisibleReasoningText(reasoningText);
        const hasVisibleFinalContent = Boolean(
          messageText.trim() || visibleReasoningText?.trim() || toolCalls?.length,
        );
        const completionLogicalMessageId = completionInfo?.logicalMessageId ?? messageId;
        const completionEventTimeMs = completionInfo?.completedAt;

        if (!hasVisibleFinalContent) {
          await Promise.all([
            messageDraftStreamManager.flushSession(sessionId),
            toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
            toolCallStreamer.breakSession(sessionId, "assistant_message_completed"),
          ]);
          return;
        }

        if (mode > 0 && visibleReasoningText) {
          const finalReasoningText = visibleReasoningText;
          const finalReasoningTitle = extractReasoningTitle(finalReasoningText);
          const translateEnabled = getTelegraphTranslateEnabled();
          const userLocale = translateEnabled ? getLocale() : undefined;
          const translatedTitle = userLocale && userLocale !== "en"
            ? (await translateText(finalReasoningTitle, userLocale)) ?? finalReasoningTitle
            : finalReasoningTitle;
          logger.debug("[ThinkingFlow] Locale for translation", {
            translateEnabled,
            userLocale,
            localeFromGetLocale: getLocale(),
          });
          const thinkingFinalizeOutcome = await finalizeThinkingBlockStream({
            sessionId,
            logicalMessageId: completionInfo?.logicalMessageId ?? messageId,
            sendApi: botApi,
            target,
            title: translatedTitle,
            reasoningText: visibleReasoningText,
            publisher: thinkingDetailsPublisher,
            locale: userLocale,
          });
          if (thinkingFinalizeOutcome === "failed") {
            logger.warn(
              `[Bot] Final thinking publication degraded: session=${sessionId}, message=${messageId}`,
            );
          }
        }

        assistantRunState.markVisibleFinalResponse(sessionId, {
          logicalMessageId: completionLogicalMessageId,
        });

        const finalFormat = getAssistantParseMode() === "MarkdownV2" ? "markdown_v2" : "raw";
        let finalText = messageText;
        let finalParseMode: "html" | "raw" | "markdown_v2" = finalFormat;
        let richMessageDelivered = false;

        // Bot API 10.1: native rich message for structured markdown content
        if (isRichContent(messageText)) {
          const deliveryTarget = getSessionDeliveryTarget(sessionId);
          const richResult = await trySendRichMessage(botApi, chatId, messageText, {
            messageThreadId: deliveryTarget?.messageThreadId ?? target.messageThreadId,
          });
          if (richResult?.success) {
            richMessageDelivered = true;
          }
        }

        if (!richMessageDelivered && mode > 0) {
          finalText = (finalFormat as string) === "html" ? messageText : markdownToHtml(messageText);
          finalParseMode = "html";
        }

        try {
          if (richMessageDelivered) {
            assistantRunState.markFinalResponsePublished(sessionId, {
              logicalMessageId: completionLogicalMessageId,
            });
            await clearThinkingBlockStream(sessionId, false);
            await Promise.all([
              messageDraftStreamManager.flushSession(sessionId),
              toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
              toolCallStreamer.breakSession(sessionId, "assistant_message_completed"),
            ]);
            await sendTtsResponseForSession({
              api: botApi,
              sessionId,
              chatId,
              text: messageText,
              messageThreadId: target.messageThreadId,
            });
          } else {
          const finalizeAssistantDelivery = finalAssistantDeliveryOrchestrator.enqueue({
            sessionId,
            channel: "durable",
            eventTimeMs: completionEventTimeMs,
            logicalMessageId: completionLogicalMessageId,
            deliver: async () => {
              const { telegramMessageIds } = await finalizeAssistantResponse({
                sessionId,
                messageId: `${messageId}:assistant`,
                messageText: finalText,
                sourceCommand: undefined,
                responseStreamer,
                flushPendingServiceMessages: () =>
                  Promise.all([
                    messageDraftStreamManager.flushSession(sessionId),
                    toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
                    toolCallStreamer.breakSession(sessionId, "assistant_message_completed"),
                  ]).then(() => undefined),
                prepareStreamingPayload: () => {
                  if (finalParseMode === "markdown_v2") {
                    const payload = prepareFinalStreamingPayload(finalText);
                    if (payload) return payload;
                  }
                  if (finalParseMode === "html") {
                    return {
                      parts: [{ text: finalText }],
                      format: "html" as const,
                    };
                  }
                  return {
                    parts: [{ text: finalText }],
                    format: finalParseMode === "markdown_v2" ? "markdown_v2" : "raw",
                  };
                },
                renderFinalParts: (text) => {
                  const summaryMode: MessageFormatMode =
                    finalParseMode === "markdown_v2"
                      ? "markdown"
                      : finalParseMode === "html"
                        ? "raw"
                        : finalParseMode;
                  if (summaryMode === "markdown" && config.bot.messageFormatMode === "markdown") {
                    return renderAssistantFinalPartsSafe(text, RESPONSE_STREAM_TEXT_LIMIT);
                  }
                  return createPlainRenderedParts(text, RESPONSE_STREAM_TEXT_LIMIT);
                },
                getReplyKeyboard: async () => await getReplyKeyboardForSession(sessionId),
                sendRenderedPart: createSendRenderedPart({
                  botApi,
                  chatId,
                  sessionId,
                  finalParseMode,
                  messageThreadId: target.messageThreadId,
                  deliveryTarget: getSessionDeliveryTarget(sessionId),
                }),
              });

              // Record message journal entries for delivered assistant messages
              if (telegramMessageIds.length > 0) {
                const journalRepo = getMessageJournalRepo();
                const project = getCurrentProject()?.worktree ?? "";
                for (const tgMsgId of telegramMessageIds) {
                  journalRepo.insert({
                    tg_chat_id: chatId,
                    tg_topic_id: target.messageThreadId ?? null,
                    tg_message_id: tgMsgId,
                    oc_server: "",
                    oc_project: project,
                    oc_session_id: sessionId,
                    oc_message_id: messageId,
                  });
                }
              }

              assistantRunState.markFinalResponsePublished(sessionId, {
                logicalMessageId: completionLogicalMessageId,
              });
            },
          });

          await finalAssistantDeliveryOrchestrator.flushSession(sessionId);
          await finalizeAssistantDelivery;

          await sendTtsResponseForSession({
            api: botApi,
            sessionId,
            chatId,
            text: messageText,
            messageThreadId: target.messageThreadId,
          });
          }
        } catch (err) {
          finalAssistantDeliveryOrchestrator.clearSession(sessionId);
          localFileFollowUpTracker.clearSession(sessionId);
          clearPromptResponseMode(sessionId);
          messageDraftStreamManager.clearSession(sessionId);
          assistantRunState.clearRun(sessionId, "assistant_finalize_failed");
          logger.error("Failed to send message to Telegram:", err);
          logger.error("[Bot] CRITICAL: Stopping event processing due to error");
          summaryAggregator.clearSession(sessionId);
        }
      });
    },
  );

  async function handleSessionIdle(
    sessionId: string,
    options: SessionIdleHandlingOptions = {},
  ): Promise<void> {
    const isDedicatedTopicSession =
      getSessionDeliveryTarget(sessionId)?.disableNotification === true;
    logger.debug("[Bot] setOnSessionIdle called", { sessionId });
    if (
      isDedicatedTopicSession &&
      hasPendingChildAssistantDelivery(sessionId) &&
      !sessionCompletionTasks.has(sessionId)
    ) {
      childSessionsAwaitingIdleCleanup.add(sessionId);
      await scheduleChildTopicDeletionWhenDeliveryCompletes(sessionId, "completed");
      return;
    }

    if (!options.skipPendingCompletionWait) {
      const pendingCompletionTask = sessionCompletionTasks.get(sessionId);
      if (pendingCompletionTask) {
        // 2026-04-19: message.updated(completed) schedules final delivery work through
        // the per-session completion queue. session.idle can arrive in the same tick,
        // so wait for that queued finalization before clearing routing/prompt state.
        await pendingCompletionTask.catch(() => undefined);

        if (isDedicatedTopicSession && shouldPreserveChildCleanupState(sessionId)) {
          return;
        }
      }
    }

    const completedRun = assistantRunState.finishRun(sessionId, "session_idle");

    // Flush accumulated Telegraph page content immediately on task completion
    void technicalDetailsPublisher.flush();
    void thinkingDetailsPublisher.flush();

    if (!completedRun) {
      logger.debug(
        `[Bot] handleSessionIdle: finishRun returned null — no active run for session=${sessionId}, isDedicatedTopicSession=${isDedicatedTopicSession}, hasLiveTarget=${!!resolveAttachedSessionTarget(sessionId)}`,
      );
    } else {
      logger.debug(
        `[Bot] handleSessionIdle: finishRun ok session=${sessionId}, hasPublishedFinalResponse=${completedRun.hasPublishedFinalResponse}`,
      );
    }

    clearPromptResponseMode(sessionId);

    syncSessionRoutingContext(sessionId);

    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || (!hasLiveSessionTarget(sessionId) && !isDedicatedTopicSession)) {
      if (isDedicatedTopicSession) {
        // 2026-05-09: child session.idle can arrive after the final answer is sent but
        // after live routing has already disappeared. Topic deletion is owned by the
        // subagent topic registry, so schedule it before clearing volatile routing state.
        await scheduleChildTopicDeletionWhenDeliveryCompletes(sessionId, "completed");
      }
      finalAssistantDeliveryOrchestrator.clearSession(sessionId);
      toolMessageBatcher.clearSession(sessionId, "session_idle_missing_routing");
      toolCallStreamer.clearSession(sessionId, "session_idle_missing_routing");
      assistantRunState.clearRun(sessionId, "session_idle_missing_routing");
      clearSessionRoutingContext(sessionId);
      localFileFollowUpTracker.clearSession(sessionId);
      messageDraftStreamManager.clearSession(sessionId);
      responseStreamer.clearSession(sessionId, "session_idle_missing_routing");
      await clearThinkingBlockStream(sessionId, false);
      foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
      await scheduledTaskRuntime.flushDeferredDeliveries();
      // Defer routing cleanup via setImmediate so a racing session.error callback
      // (also queued via setImmediate) can access the routing context before it is cleared.
      setImmediate(() => {
        clearSessionRoutingContext(sessionId);
      });
      return;
    }

    try {
      await Promise.all([
        toolMessageBatcher.flushSession(sessionId, "session_idle"),
        toolCallStreamer.flushSession(sessionId, "session_idle"),
      ]);

      // Sync forum topic name with session title BEFORE sending final footer
      if (!managedChildSessionIds.has(sessionId) && target?.messageThreadId) {
        const sessionTitle = childSessionTitle.get(sessionId);
        if (sessionTitle) {
          const truncated = sessionTitle.length > 128 ? sessionTitle.slice(0, 125) + "..." : sessionTitle;
          const lastSetName = childTopicLastSetName.get(sessionId);
          if (truncated !== lastSetName) {
            safeBackgroundTask({
              taskName: `topic-sync.${sessionId}`,
              task: async () => {
                try {
                  await botApi.editForumTopic(target.chatId, target.messageThreadId!, { name: truncated });
                  childTopicLastSetName.set(sessionId, truncated);
                } catch {
                  // ignore rename failures
                }
              },
            });
          }
        }
      }

      if (completedRun?.hasPublishedFinalResponse) {
        const agent = completedRun.actualAgent || completedRun.configuredAgent;
        const providerID = completedRun.actualProviderID || completedRun.configuredProviderID;
        const modelID = completedRun.actualModelID || completedRun.configuredModelID;

        if (agent && providerID && modelID) {
          const footerDelivery = finalAssistantDeliveryOrchestrator.enqueue({
            sessionId,
            channel: "durable",
            eventTimeMs: completedRun.completedAt,
            waitForLogicalMessageDurable: completedRun.publishedFinalLogicalMessageId,
            deliver: async () => {
              // Stop typing before sending the final footer
              summaryAggregator.stopTypingIndicator();
              const keyboard = await getReplyKeyboardForSession(sessionId);
              await botApi.sendMessage(
                target.chatId,
                formatAssistantRunFooter({
                  agent,
                  providerID,
                  modelID,
                  elapsedMs: (completedRun.completedAt ?? Date.now()) - completedRun.startedAt,
                  inputTokens:
                    (maternalTokenUsage.get(sessionId)?.input ?? 0) +
                    (subagentTokensByParent.get(sessionId)?.input ?? 0),
                  outputTokens:
                    (maternalTokenUsage.get(sessionId)?.output ?? 0) +
                    (subagentTokensByParent.get(sessionId)?.output ?? 0),
                }),
                withMessageThreadId(
                  {
                    ...(keyboard ? { reply_markup: keyboard } : {}),
                  },
                  target.messageThreadId,
                ),
              );
            },
          });

          await finalAssistantDeliveryOrchestrator.flushSession(sessionId);
          await footerDelivery;
        }
      }

      const idleScopeKey = getSessionRoutingScopeKey(sessionId);
      await deferredBatch.flushExpiredWindowsForScope(idleScopeKey);
    } catch (err) {
      logger.error("[Bot] Failed to send session idle footer:", err);
    } finally {
      if (isDedicatedTopicSession) {
        await scheduleChildTopicDeletionWhenDeliveryCompletes(sessionId, "completed");
      }
      finalAssistantDeliveryOrchestrator.clearSession(sessionId);
      await clearThinkingBlockStream(sessionId, false);
      clearChildAssistantSession(sessionId);
      // Defer routing cleanup so a racing session.error callback
      // can access the routing context before it is cleared.
      setImmediate(() => {
        clearSessionRoutingContext(sessionId);
      });
      localFileFollowUpTracker.clearSession(sessionId);
      messageDraftStreamManager.clearSession(sessionId);
      foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
      await scheduledTaskRuntime.flushDeferredDeliveries();
    }
  }

  summaryAggregator.setOnSessionIdle(async (sessionId) => {
    await handleSessionIdle(sessionId);
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
    // 2026-05-29: Wait for child topic routing to be established before
    // streaming tool notifications. Without this, tool calls can route to
    // the parent topic during the seeding window.
    const pendingRoutingSetup = pendingChildRoutingSetupBySessionId.get(toolInfo.sessionId);
    if (pendingRoutingSetup) {
      await pendingRoutingSetup.catch(() => false);
    }

    const orderedPublication = scheduleOrderedPublication(toolInfo.sessionId, {
      eventTimeMs: toolInfo.eventTimeMs,
      logicalMessageId: buildToolPublicationLogicalMessageId(toolInfo),
    });

    syncSessionRoutingContext(toolInfo.sessionId);
    if (!isSessionCurrent(toolInfo.sessionId)) {
      orderedPublication.resolve(null);
      toolCallStreamer.clearSession(toolInfo.sessionId, "tool_missing_live_routing");
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    const shouldIncludeToolInfoInFileCaption =
      toolInfo.hasFileAttachment &&
      (toolInfo.tool === "write" || toolInfo.tool === "edit" || toolInfo.tool === "apply_patch");

    try {
      if (
        (await getHideToolCallMessagesForSession(toolInfo.sessionId)) ||
        shouldIncludeToolInfoInFileCaption
      ) {
        orderedPublication.resolve(null);
        return;
      }

      const formattedProgress = formatTechnicalProgressSync(toolInfo);
      if (formattedProgress.text) {
        if (!isSessionCurrent(toolInfo.sessionId)) {
          orderedPublication.resolve(null);
          toolCallStreamer.clearSession(toolInfo.sessionId, "tool_lost_live_routing_before_queue");
          return;
        }

        const prefix = `tool:${toolInfo.callId}`;
        orderedPublication.resolve(async () => {
          toolCallStreamer.replaceByPrefix(toolInfo.sessionId, prefix, formattedProgress.text);
          await enqueueLocalFileFollowUpsFromText(
            toolInfo.sessionId,
            joinFollowUpCandidateTexts(
              formattedProgress.text,
              toolInfo.title,
              typeof toolInfo.input?.description === "string" ? toolInfo.input.description : undefined,
              typeof toolInfo.input?.command === "string" ? toolInfo.input.command : undefined,
            ),
          );

          safeBackgroundTask({
            taskName: `technical-progress-details.${toolInfo.sessionId}.${toolInfo.callId}`,
            task: async () => {
              const callKey = `${toolInfo.sessionId}:${toolInfo.callId}`;
              if (publishedToolDetailCallIds.has(callKey)) {
                return;
              }

              const stateStatus = (toolInfo.state as Record<string, unknown>)?.status;
              if (stateStatus !== "completed") {
                return;
              }

              const linkedProgress = await formatTechnicalProgressWithDetails(
                toolInfo,
                technicalDetailsPublisher,
              );
              if (linkedProgress.format !== "html" || !linkedProgress.text) {
                return;
              }

              publishedToolDetailCallIds.add(callKey);

              if (!isSessionCurrent(toolInfo.sessionId)) {
                return;
              }

              if (!toolCallStreamer.hasPrefix(toolInfo.sessionId, prefix)) {
                return;
              }

              toolCallStreamer.replaceByPrefix(
                toolInfo.sessionId,
                prefix,
                linkedProgress.text,
              );

              // Send tool output as native rich message with code formatting
              void (async () => {
                try {
                  const rawOutput = extractToolOutput(
                    toolInfo.tool,
                    toolInfo.input as Record<string, unknown> | undefined,
                    toolInfo.metadata as Record<string, unknown> | undefined,
                    (toolInfo.state as Record<string, unknown>)?.output,
                  );
                  if (!rawOutput) return;
                  const richMarkdown = formatToolOutputForRichMessage(
                    toolInfo.tool,
                    toolInfo.input as Record<string, unknown> | undefined,
                    rawOutput,
                  );
                  if (richMarkdown) {
                    const toolApi = getSessionRoutingApi(toolInfo.sessionId);
                    const toolTarget = getSessionRoutingTarget(toolInfo.sessionId);
                    if (toolApi && toolTarget) {
                      await trySendRichMessage(
                        toolApi,
                        toolTarget.chatId,
                        richMarkdown,
                        { messageThreadId: toolTarget.messageThreadId },
                      );
                    }
                  }
                } catch {
                  // ignore rich message errors for tool outputs
                }
              })();
            },
          });
        });
        return;
      }

      orderedPublication.resolve(null);
    } catch (err) {
      orderedPublication.resolve(null);
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  const subagentLastLoggedTool = new Map<string, string>();

  summaryAggregator.setOnSubagent(async (sessionId, subagents, eventTimeMs) => {
    const orderedPublication = scheduleOrderedPublication(sessionId, {
      eventTimeMs,
      logicalMessageId: buildSubagentPublicationLogicalMessageId(sessionId),
    });

    syncSessionRoutingContext(sessionId);
    if (!isSessionCurrent(sessionId)) {
      orderedPublication.resolve(null);
      return;
    }

    try {
      for (const subagent of subagents) {
        if (!subagent.sessionId) {
          continue;
        }

        const childId = subagent.sessionId;

        seedChildRoutingFromSubagent({
          parentSessionId: sessionId,
          childSessionId: childId,
          topicName: subagent.description || subagent.prompt || subagent.agent || "Subagent",
        });

        if (!childSessionMeta.has(childId)) {
          childSessionMeta.set(childId, {
            agent: subagent.agent || "subagent",
            providerID: subagent.providerID || "",
            modelID: subagent.modelID || "",
            startTime: eventTimeMs ?? Date.now(),
            tokens: {
              input: subagent.tokens?.input ?? 0,
              output: subagent.tokens?.output ?? 0,
              reasoning: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
          });
        } else {
          const meta = childSessionMeta.get(childId)!;
          if (subagent.providerID) meta.providerID = subagent.providerID;
          if (subagent.modelID) meta.modelID = subagent.modelID;
          meta.tokens.input = Math.max(meta.tokens.input, subagent.tokens?.input ?? 0);
          meta.tokens.output = Math.max(meta.tokens.output, subagent.tokens?.output ?? 0);
        }
        subagentTokensByParent.set(sessionId, {
          input: [...childSessionMeta.values()]
            .filter((m) => m.tokens.input > 0 || m.tokens.output > 0)
            .reduce((sum, m) => sum + m.tokens.input, 0),
          output: [...childSessionMeta.values()]
            .filter((m) => m.tokens.input > 0 || m.tokens.output > 0)
            .reduce((sum, m) => sum + m.tokens.output, 0),
        });

        const promptText = subagent.prompt || subagent.description || "";
        const promptMessage = promptText
          ? `🧩 <b>${escapeHtml(subagent.agent || "Subagent")}</b>\n\n<code>${escapeHtml(promptText)}</code>`
          : undefined;

        const routingSetup = syncSubagentDeliverySerialized({
          childSessionId: subagent.sessionId,
          parentSessionId: sessionId,
          topicName: subagent.description || subagent.prompt || subagent.agent || "Subagent",
          promptMessage,
        });
        pendingChildRoutingSetupBySessionId.set(subagent.sessionId, routingSetup);

        await routingSetup.catch(() => false);
        pendingChildRoutingSetupBySessionId.delete(subagent.sessionId);
      }

      // Log subagent tool events to Telegraph and collect URLs
      if (subagentTelegraphLogger) {
        for (const subagent of subagents) {
          if (!subagent.sessionId) continue;
          const toolKey = subagent.currentTool ?? subagent.status ?? "";
          const lastKey = subagentLastLoggedTool.get(subagent.sessionId);
          if (toolKey !== lastKey) {
            subagentLastLoggedTool.set(subagent.sessionId, toolKey);
            void subagentTelegraphLogger.logEvent({
              sessionId: subagent.sessionId,
              title: subagent.description || "Subagent",
              tool: subagent.currentToolTitle,
              detail: subagent.currentTool,
              status: subagent.status === "completed" || subagent.status === "error" ? subagent.status : undefined,
            });
          }
        }
      }

      const enrichedSubagents = subagents.map((subagent) => {
        if (!subagent.sessionId) return subagent;

        const childLastMsg = childSessionLastMessage.get(subagent.sessionId);
        if (childLastMsg) {
          return { ...subagent, lastMessage: childLastMsg };
        }

        if (subagentTelegraphLogger) {
          const telegraphUrl = subagentTelegraphLogger.getPageUrl(subagent.sessionId);
          if (telegraphUrl) {
            return {
              ...subagent,
              topicLinkUrl: telegraphUrl,
            };
          }
        }

        const linkState = subagentTopicService.getLinkState(subagent.sessionId);
        if (!linkState) return subagent;
        if (linkState.kind === "stopped") {
          return { ...subagent, stoppedLine: t("subagent.topic_stopped") };
        }
        return {
          ...subagent,
          topicLinkUrl: linkState.url,
        };
      });

      if (await getHideToolCallMessagesForSession(sessionId)) {
        orderedPublication.resolve(null);
        return;
      }

      const activeSubagents = enrichedSubagents.filter(
        (s) => s.status !== "completed" && s.status !== "error",
      );
      const renderedCards = await renderSubagentCards(activeSubagents);
      if (!renderedCards) {
        orderedPublication.resolve(null);
        return;
      }

      if (!isSessionCurrent(sessionId)) {
        orderedPublication.resolve(null);
        return;
      }

      const spoilerCards = formatToolCallAsSpoiler(renderedCards);
      orderedPublication.resolve(async () => {
        toolCallStreamer.replaceByPrefix(sessionId, SUBAGENT_STREAM_PREFIX, spoilerCards);
        await enqueueLocalFileFollowUpsFromText(sessionId, spoilerCards);
      });
    } catch (err) {
      orderedPublication.resolve(null);
      logger.error("Failed to render subagent activity for Telegram:", err);
    }
  });

  summaryAggregator.setOnToolFile(async (fileInfo) => {
    // 2026-05-29: Wait for child topic routing to be established before sending files.
    // Without this, files could route to the parent topic during the seeding window
    // (between seedChildRoutingFromSubagent and syncSubagentDeliveryContextForSession).
    const pendingRoutingSetup = pendingChildRoutingSetupBySessionId.get(fileInfo.sessionId);
    if (pendingRoutingSetup) {
      await pendingRoutingSetup.catch(() => false);
    }

    syncSessionRoutingContext(fileInfo.sessionId);
    if (!isSessionCurrent(fileInfo.sessionId)) {
      logger.error("Bot or chat ID not available for sending file");
      return;
    }

    try {
      await toolCallStreamer.breakSession(fileInfo.sessionId, "tool_file_boundary");

      if (await getHideToolFileMessagesForSession(fileInfo.sessionId)) {
        return;
      }

      const formattedFileProgress = await formatTechnicalProgressWithDetails(
        fileInfo,
        technicalDetailsPublisher,
      );
      const toolMessage = formattedFileProgress.text || formatToolInfo(fileInfo);
      const caption = prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

      toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
        ...fileInfo.fileData,
        caption,
        ...(formattedFileProgress.format === "html" ? { captionFormat: "html" as const } : {}),
      });
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    }
  });

  summaryAggregator.setOnQuestion(async (sessionId, questions, requestID) => {
    const pendingRoutingSetup = pendingChildRoutingSetupBySessionId.get(sessionId);
    if (pendingRoutingSetup) {
      await pendingRoutingSetup.catch(() => false);
    }

    syncSessionRoutingContext(sessionId);
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    const scopeKey = getSessionRoutingScopeKey(sessionId);
    if (!botApi || !target) {
      logger.error("Bot or chat ID not available for showing questions");
      return;
    }

    await Promise.all([
      toolMessageBatcher.flushSession(sessionId, "question_asked"),
      toolCallStreamer.flushSession(sessionId, "question_asked"),
    ]);

    if (questionManager.isActive(scopeKey)) {
      logger.warn("[Bot] Replacing active poll with a new one");

      const previousMessageIds = questionManager.getMessageIds(scopeKey);
      for (const messageId of previousMessageIds) {
        await botApi.deleteMessage(target.chatId, messageId).catch(() => {});
      }

      clearAllInteractionState("question_replaced_by_new_poll", scopeKey);
    }

    logger.info(`[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`);
    questionManager.startQuestions(questions, requestID, {
      scopeKey,
      sessionId,
      runtimeContext: {
        directory: getCurrentSession()?.directory ?? getCurrentProject()?.worktree ?? null,
      },
    });
    const deliveryTarget = getSessionDeliveryTarget(sessionId);
    await runWithSessionRoutingScope(sessionId, () =>
      showCurrentQuestion(botApi, target.chatId, target.messageThreadId, undefined, deliveryTarget),
    );
  });

  summaryAggregator.setOnQuestionError(async (sessionId) => {
    logger.info(`[Bot] Question tool failed, clearing active poll and deleting messages`);

    syncSessionRoutingContext(sessionId);
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    const scopeKey = getSessionRoutingScopeKey(sessionId);

    const messageIds = questionManager.getMessageIds(scopeKey);
    for (const messageId of messageIds) {
      if (botApi && target) {
        await botApi.deleteMessage(target.chatId, messageId).catch((err) => {
          logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
        });
      }
    }

    clearAllInteractionState("question_error", scopeKey);
  });

  summaryAggregator.setOnPermission(async (request) => {
    const pendingRoutingSetup = pendingChildRoutingSetupBySessionId.get(request.sessionID);
    if (pendingRoutingSetup) {
      await pendingRoutingSetup.catch(() => false);
    }

    const parentSessionId = summaryAggregator.getParentSessionId(request.sessionID);
    const effectiveSessionId = parentSessionId ?? request.sessionID;

    syncSessionRoutingContext(effectiveSessionId);
    const botApi = getSessionRoutingApi(effectiveSessionId);
    const target = getSessionRoutingTarget(effectiveSessionId);
    if (!botApi || !target) {
      logger.error("Bot or chat ID not available for showing permission request");
      return;
    }

    await Promise.all([
      toolMessageBatcher.flushSession(effectiveSessionId, "permission_asked"),
      toolCallStreamer.flushSession(effectiveSessionId, "permission_asked"),
    ]);

    logger.info(
      `[Bot] Received permission request: type=${request.permission}, requestID=${request.id}${parentSessionId ? `, parentSession=${parentSessionId}` : ""}`,
    );

    const effectiveScopeKey = getSessionRoutingScopeKey(effectiveSessionId);

    const sendFn = async (queuedRequest: typeof request) => {
      const dTarget = getSessionDeliveryTarget(effectiveSessionId);
      await runWithSessionRoutingScope(effectiveSessionId, () =>
        showPermissionRequest(botApi, target.chatId, queuedRequest, target.messageThreadId, effectiveScopeKey, dTarget),
      );
    };
    registerPermissionSendFn(effectiveScopeKey, sendFn);

    const deliveryTarget = getSessionDeliveryTarget(effectiveSessionId);
    await runWithSessionRoutingScope(effectiveSessionId, () =>
      showPermissionRequest(botApi, target.chatId, request, target.messageThreadId, effectiveScopeKey, deliveryTarget),
    );
  });

  summaryAggregator.setOnThinking(async (sessionId) => {
    syncSessionRoutingContext(sessionId);
    if (!getSessionRoutingApi(sessionId) || !getSessionRoutingTarget(sessionId)) {
      return;
    }

    if (assistantRunState.isFinalResponsePublished(sessionId)) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    await toolCallStreamer.breakSession(sessionId, "thinking_started");

    if (pinnedMessageManager.isInitialized()) {
      await pinnedMessageManager.refresh();
    }
  });

  summaryAggregator.setOnTokens(async (sessionId, tokens, isCompleted) => {
    const scope = threadContextManager.getSessionScope(sessionId);
    if (!scope) {
      return;
    }
    await runWithTelegramConversationScope(scope, async () => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.debug(
          `[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}, completed=${isCompleted}`,
        );

        const contextSize = tokens.input + tokens.cacheRead;
        const contextLimit = pinnedMessageManager.getContextLimit();

        if (!isCompleted && contextSize === 0) {
          logger.debug("[Bot] Skipping zero-token intermediate update");
          return;
        }

        if (contextLimit > 0) {
          keyboardManager.updateContext(contextSize, contextLimit);
        }
        pinnedMessageManager.updateTokensSilent(tokens);

        if (isCompleted) {
          await pinnedMessageManager.onMessageComplete(tokens);
        }
      } catch (err) {
        logger.error("[Bot] Error updating pinned message with tokens:", err);
      }
    });
  });

  summaryAggregator.setOnCost(async (sessionId, cost) => {
    const scope = threadContextManager.getSessionScope(sessionId);
    if (!scope) {
      return;
    }
    await runWithTelegramConversationScope(scope, async () => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.debug(`[Bot] Cost update: $${cost.toFixed(2)}`);
        await pinnedMessageManager.onCostUpdate(cost);
      } catch (err) {
        logger.error("[Bot] Error updating cost:", err);
      }
    });
  });

  summaryAggregator.setOnSessionCompacted(async (sessionId, directory) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.info(`[Bot] Session compacted, reloading context: ${sessionId}`);
      await pinnedMessageManager.onSessionCompacted(sessionId, directory);
    } catch (err) {
      logger.error("[Bot] Error reloading context after compaction:", err);
    }
  });

  summaryAggregator.setOnSessionError(async (sessionId, message) => {
    const routing = getPromptRoutingContext(sessionId) ?? getSessionRoutingContext(sessionId);
    const routingScope = routing?.scope ?? getSessionRoutingScope(sessionId);
    const target = routing?.target ?? getSessionRoutingTarget(sessionId);
    const hasDedicatedTopicTarget =
      getSessionDeliveryTarget(sessionId)?.disableNotification === true;
    const hasLiveTarget = hasLiveSessionTarget(sessionId) || hasDedicatedTopicTarget;
    const shouldClearThinkingBlock = await runWithTelegramConversationScope(
      routingScope,
      async () => getThinkingClearMode(),
    );

    if (isModelUnavailableError(message)) {
      let originalModel: ModelInfo;
      let originalModelName: string;
      const currentScope = routingScope;
      if (currentScope) {
        const current = await runWithTelegramConversationScope(currentScope, () =>
          getStoredModel(),
        );
        originalModel = current;
        originalModelName =
          current.providerID && current.modelID
            ? `${current.providerID}/${current.modelID}`
            : "default";
      } else {
        originalModel = { providerID: "", modelID: "", variant: "default" };
        originalModelName = "default";
      }

      const fallbackModel = getFallbackModel();
      if (!fallbackModel) {
        logger.warn(
          `[Bot] session.error model-unavailable: "${message}", sessionId=${sessionId}, model=${originalModelName}, no fallback configured`,
        );
        if (routing && target) {
          void routing.bot.api
            .sendMessage(
              target.chatId,
              t("bot.model_unavailable_no_fallback", { model: originalModelName }),
              withMessageThreadId(undefined, target.messageThreadId),
            )
            .catch(() => {});
        }
        return;
      }

      if (isAlreadyOnFallbackModel(originalModel)) {
        logger.warn(
          `[Bot] session.error model-unavailable: "${message}", sessionId=${sessionId}, already on fallback ${originalModelName}`,
        );
        if (routing && target) {
          void routing.bot.api
            .sendMessage(
              target.chatId,
              t("bot.model_unavailable_on_fallback", { model: originalModelName }),
              withMessageThreadId(undefined, target.messageThreadId),
            )
            .catch(() => {});
        }
        return;
      }

      const fallbackName = `${fallbackModel.providerID}/${fallbackModel.modelID}`;
      logger.warn(
        `[Bot] session.error model-unavailable: "${message}", switching ${sessionId} from ${originalModelName} to fallback ${fallbackName}`,
      );

      if (currentScope) {
        setCurrentModelForScope(currentScope, fallbackModel);
        const contextKey = buildTelegramConversationScopeKey(currentScope);
        threadContextManager.updateModelBinding(contextKey, fallbackModel);
        keyboardManager.updateModel(fallbackModel);
      } else {
        switchToFallbackModel();
      }

      if (routing && target) {
        void routing.bot.api
          .sendMessage(
            target.chatId,
            t("bot.model_fallback_switch", {
              model: originalModelName,
              fallback: fallbackName,
            }),
            withMessageThreadId(undefined, target.messageThreadId),
          )
          .catch(() => {});
      }

      const retryCtx = getPromptRetryContext(sessionId);
      if (!retryCtx?.directory) {
        return;
      }

      try {
        deletePromptRetryContext(sessionId);
        summaryAggregator.setSession(sessionId);

        const retryResult = await runWithTelegramConversationScope(routingScope, async () =>
          opencodeClient.session.promptAsync({
            sessionID: sessionId,
            directory: retryCtx.directory,
            parts: [{ type: "text", text: retryCtx.lastText }],
            model: { providerID: fallbackModel.providerID, modelID: fallbackModel.modelID },
            agent: retryCtx.agent,
            variant: fallbackModel.variant,
          }),
        );

        const sdkError =
          typeof retryResult === "object" &&
          retryResult !== null &&
          "error" in retryResult
            ? (retryResult as { error?: unknown }).error ?? null
            : null;
        if (sdkError) {
          logger.error(
            `[Bot] Fallback model retry returned SDK error: sessionId=${sessionId}`,
            sdkError,
          );
          throw sdkError;
        }

        logger.info(`[Bot] Fallback model retry dispatched: ${sessionId}`);

        assistantRunState.clearRun(sessionId, "session_error_model_fallback");
        assistantRunState.startRun(sessionId, {
          startedAt: Date.now(),
          configuredProviderID: fallbackModel.providerID,
          configuredModelID: fallbackModel.modelID,
        });

        await Promise.all([
          toolMessageBatcher.flushSession(sessionId, "session_error_fallback_retry"),
          toolCallStreamer.flushSession(sessionId, "session_error_fallback_retry"),
        ]);
        if (routing && target) {
          await clearThinkingBlockStream(sessionId, shouldClearThinkingBlock, {
            sendText: async (text: string) => {
              const sent = await routing.bot.api.sendMessage(
                target.chatId,
                text,
                withMessageThreadId(
                  { parse_mode: "HTML" as const, disable_notification: true },
                  target.messageThreadId,
                ),
              );
              return sent.message_id;
            },
            editText: async (messageId: number, text: string) => {
              await routing.bot.api.editMessageText(
                target.chatId,
                messageId,
                text,
                withMessageThreadId({ parse_mode: "HTML" as const }, target.messageThreadId),
              );
            },
            deleteText: async (messageId: number) => {
              await routing.bot.api
                .deleteMessage(target.chatId, messageId)
                .catch(() => undefined);
            },
            routingIdentity: buildThinkingRoutingIdentity(target),
          });
        } else {
          await clearThinkingBlockStream(sessionId, shouldClearThinkingBlock);
        }
        return;
      } catch (retryError) {
        logger.error("[Bot] Fallback model retry from session.error failed:", retryError);
        console.error("[Bot] Fallback model retry from session.error failed:", retryError);
        if (routing && target) {
          void routing.bot.api
            .sendMessage(
              target.chatId,
              t("bot.session_error"),
              withMessageThreadId({ disable_notification: true }, target.messageThreadId),
            )
            .catch(() => {});
        }
      }
    }

    if (isSseReadTimeoutError(message)) {
      const retryCtx = getPromptRetryContext(sessionId);
      if (retryCtx?.directory && routing && target) {
        logger.warn(
          `[Bot] session.error SSE read timeout: "${message}", auto-retrying sessionId=${sessionId}`,
        );
        try {
          void routing.bot.api
            .sendMessage(
              target.chatId,
              t("bot.session_sse_timeout_retry"),
              withMessageThreadId({ disable_notification: true }, target.messageThreadId),
            )
            .catch(() => {});

          assistantRunState.clearRun(sessionId, "session_error_sse_timeout");
          deletePromptRetryContext(sessionId);
          summaryAggregator.setSession(sessionId);

          await runWithTelegramConversationScope(routingScope, async () =>
            opencodeClient.session.promptAsync({
              sessionID: sessionId,
              directory: retryCtx.directory,
              parts: [{ type: "text", text: retryCtx.lastText }],
              agent: retryCtx.agent,
            }),
          );

          assistantRunState.startRun(sessionId, {
            startedAt: Date.now(),
            configuredAgent: retryCtx.agent,
          });

          await clearThinkingBlockStream(sessionId, shouldClearThinkingBlock);
          return;
        } catch (retryError) {
          logger.warn(
            `[Bot] SSE timeout retry failed, falling through to error display: sessionId=${sessionId}`,
            retryError,
          );
        }
      } else {
        logger.warn(
          `[Bot] session.error SSE read timeout without retry context: sessionId=${sessionId}`,
        );
      }
    }

    if (!routing || !target || !hasLiveTarget) {
      finalAssistantDeliveryOrchestrator.clearSession(sessionId);
      clearPromptResponseMode(sessionId);
      localFileFollowUpTracker.clearSession(sessionId);
      clearSessionRoutingContext(sessionId);
      messageDraftStreamManager.clearSession(sessionId);
      responseStreamer.clearSession(sessionId, "session_error_missing_routing");
      toolMessageBatcher.clearSession(sessionId, "session_error_missing_routing");
      toolCallStreamer.clearSession(sessionId, "session_error_missing_routing");
      assistantRunState.clearRun(sessionId, "session_error_missing_routing");
      await clearThinkingBlockStream(sessionId, shouldClearThinkingBlock);
      foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
      await scheduledTaskRuntime.flushDeferredDeliveries();
      return;
    }

    messageDraftStreamManager.clearSession(sessionId);
    responseStreamer.clearSession(sessionId, "session_error");
    finalAssistantDeliveryOrchestrator.clearSession(sessionId);
    localFileFollowUpTracker.clearSession(sessionId);
    assistantRunState.clearRun(sessionId, "session_error");
    clearPromptResponseMode(sessionId);
    await Promise.all([
      toolMessageBatcher.flushSession(sessionId, "session_error"),
      toolCallStreamer.flushSession(sessionId, "session_error"),
      clearThinkingBlockStream(sessionId, shouldClearThinkingBlock, {
        sendText: async (text: string) => {
          const sent = await routing.bot.api.sendMessage(
            target.chatId,
            text,
            withMessageThreadId(
              { parse_mode: "HTML" as const, disable_notification: true },
              target.messageThreadId,
            ),
          );
          return sent.message_id;
        },
        editText: async (messageId: number, text: string) => {
          await routing.bot.api.editMessageText(
            target.chatId,
            messageId,
            text,
            withMessageThreadId({ parse_mode: "HTML" as const }, target.messageThreadId),
          );
        },
        deleteText: async (messageId: number) => {
          await routing.bot.api.deleteMessage(target.chatId, messageId).catch(() => undefined);
        },
        routingIdentity: buildThinkingRoutingIdentity(target),
      }),
    ]);

    const normalizedMessage = message.trim() || t("common.unknown_error");
    if (shouldSuppressUserAbortSessionError(sessionId, normalizedMessage)) {
      logger.debug(`[Bot] Suppressed user-initiated abort error: session=${sessionId}`);
      clearSessionRoutingContext(sessionId);
      clearChildAssistantSession(sessionId);
      localFileFollowUpTracker.clearSession(sessionId);
      foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
      await scheduledTaskRuntime.flushDeferredDeliveries();
      return;
    }

    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    await runWithSessionRoutingScope(sessionId, () =>
      routing.bot.api
        .sendMessage(
          target.chatId,
          t("bot.session_error", { message: truncatedMessage }),
          withMessageThreadId(undefined, target.messageThreadId),
        )
        .catch((err) => {
          logger.error("[Bot] Failed to send session.error message:", err);
        }),
    );

    if (hasDedicatedTopicTarget) {
      const autoDeleteMinutes = await runWithTelegramConversationScope(
        getSessionRoutingScope(sessionId),
        () => getSubagentTopicAutoDeleteMinutes(),
      );
      subagentTopicService.markTerminalStatus(sessionId, "errored");
      subagentTopicService.confirmFinalDelivery(sessionId, autoDeleteMinutes);
    }

    clearSessionRoutingContext(sessionId);
    clearChildAssistantSession(sessionId);
    localFileFollowUpTracker.clearSession(sessionId);
      foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
      summaryAggregator.stopTypingIndicator();
      await scheduledTaskRuntime.flushDeferredDeliveries();
  });

  summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
    syncSessionRoutingContext(sessionId);
    if (!getPromptRoutingContext(sessionId) && !getSessionRoutingContext(sessionId)) {
      return;
    }

    if (isModelUnavailableError(message)) {
      const routing = getPromptRoutingContext(sessionId) ?? getSessionRoutingContext(sessionId);
      const routingScope = routing?.scope ?? getSessionRoutingScope(sessionId);
      const target = routing?.target ?? getSessionRoutingTarget(sessionId);

      let originalModel: ModelInfo;
      let originalModelName: string;
      if (routingScope) {
        const current = await runWithTelegramConversationScope(routingScope, () =>
          getStoredModel(),
        );
        originalModel = current;
        originalModelName =
          current.providerID && current.modelID
            ? `${current.providerID}/${current.modelID}`
            : "default";
      } else {
        originalModel = { providerID: "", modelID: "", variant: "default" };
        originalModelName = "default";
      }

      const fallbackModel = getFallbackModel();
      if (!fallbackModel) {
        logger.warn(
          `[Bot] session.retry model-unavailable: "${message}", sessionId=${sessionId}, model=${originalModelName}, no fallback configured`,
        );
        if (routing && target) {
          void routing.bot.api
            .sendMessage(
              target.chatId,
              t("bot.model_unavailable_no_fallback", { model: originalModelName }),
              withMessageThreadId(undefined, target.messageThreadId),
            )
            .catch(() => {});
        }
        return;
      }

      if (isAlreadyOnFallbackModel(originalModel)) {
        logger.warn(
          `[Bot] session.retry model-unavailable: "${message}", sessionId=${sessionId}, already on fallback ${originalModelName}`,
        );
        if (routing && target) {
          void routing.bot.api
            .sendMessage(
              target.chatId,
              t("bot.model_unavailable_on_fallback", { model: originalModelName }),
              withMessageThreadId(undefined, target.messageThreadId),
            )
            .catch(() => {});
        }
        return;
      }

      const fallbackName = `${fallbackModel.providerID}/${fallbackModel.modelID}`;
      logger.warn(
        `[Bot] session.retry model-unavailable: "${message}", switching ${sessionId} from ${originalModelName} to fallback ${fallbackName}`,
      );

      if (routingScope) {
        setCurrentModelForScope(routingScope, fallbackModel);
        const contextKey = buildTelegramConversationScopeKey(routingScope);
        threadContextManager.updateModelBinding(contextKey, fallbackModel);
        keyboardManager.updateModel(fallbackModel);
      } else {
        switchToFallbackModel();
      }

      if (routing && target) {
        void routing.bot.api
          .sendMessage(
            target.chatId,
            t("bot.model_fallback_switch", {
              model: originalModelName,
              fallback: fallbackName,
            }),
            withMessageThreadId(undefined, target.messageThreadId),
          )
          .catch(() => {});
      }

      try {
        const dir = threadContextManager.getSessionDirectory(sessionId);
        if (dir) {
          await opencodeClient.session.abort({ sessionID: sessionId, directory: dir });
          logger.info(`[Bot] Aborted session after model-unavailable retry: ${sessionId}`);
        }
      } catch (abortErr) {
        logger.warn(`[Bot] Failed to abort session ${sessionId} after model-unavailable retry:`, abortErr);
      }

      const retryCtx = getPromptRetryContext(sessionId);
      if (!retryCtx?.directory) {
        return;
      }

      const shouldClearThinkingBlock = await runWithTelegramConversationScope(
        routingScope,
        async () => getThinkingClearMode(),
      );

      try {
        deletePromptRetryContext(sessionId);
        summaryAggregator.setSession(sessionId);

        const retryResult = await runWithTelegramConversationScope(routingScope, async () =>
          opencodeClient.session.promptAsync({
            sessionID: sessionId,
            directory: retryCtx.directory,
            parts: [{ type: "text", text: retryCtx.lastText }],
            model: { providerID: fallbackModel.providerID, modelID: fallbackModel.modelID },
            agent: retryCtx.agent,
            variant: fallbackModel.variant,
          }),
        );

        const sdkError =
          typeof retryResult === "object" &&
          retryResult !== null &&
          "error" in retryResult
            ? (retryResult as { error?: unknown }).error ?? null
            : null;
        if (sdkError) {
          logger.error(
            `[Bot] Fallback model retry from session.retry returned SDK error: sessionId=${sessionId}`,
            sdkError,
          );
          throw sdkError;
        }

        logger.info(`[Bot] Fallback model retry dispatched from session.retry: ${sessionId}`);

        assistantRunState.clearRun(sessionId, "session_retry_model_fallback");
        assistantRunState.startRun(sessionId, {
          startedAt: Date.now(),
          configuredProviderID: fallbackModel.providerID,
          configuredModelID: fallbackModel.modelID,
        });

        await Promise.all([
          toolMessageBatcher.flushSession(sessionId, "session_retry_fallback_retry"),
          toolCallStreamer.flushSession(sessionId, "session_retry_fallback_retry"),
        ]);
        if (routing && target) {
          await clearThinkingBlockStream(sessionId, shouldClearThinkingBlock, {
            sendText: async (text: string) => {
              const sent = await routing.bot.api.sendMessage(
                target.chatId,
                text,
                withMessageThreadId(
                  { parse_mode: "HTML" as const, disable_notification: true },
                  target.messageThreadId,
                ),
              );
              return sent.message_id;
            },
            editText: async (messageId: number, text: string) => {
              await routing.bot.api.editMessageText(
                target.chatId,
                messageId,
                text,
                withMessageThreadId({ parse_mode: "HTML" as const }, target.messageThreadId),
              );
            },
            deleteText: async (messageId: number) => {
              await routing.bot.api
                .deleteMessage(target.chatId, messageId)
                .catch(() => undefined);
            },
            routingIdentity: buildThinkingRoutingIdentity(target),
          });
        } else {
          await clearThinkingBlockStream(sessionId, shouldClearThinkingBlock);
        }
      } catch (retryError) {
        logger.error("[Bot] Fallback model retry from session.retry failed:", retryError);
        console.error("[Bot] Fallback model retry from session.retry failed:", retryError);
      }
      return;
    }

    const normalizedMessage = message.trim() || t("common.unknown_error");
    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    const retryMessage = t("bot.session_retry", { message: truncatedMessage });
    toolCallStreamer.replaceByPrefix(sessionId, SESSION_RETRY_PREFIX, retryMessage);
  });

  summaryAggregator.setOnSessionDiff(async (sessionId, diffs) => {
    const scope = threadContextManager.getSessionScope(sessionId);
    if (!scope) {
      return;
    }
    await runWithTelegramConversationScope(scope, async () => {
      if (fileDiffLogger) {
        const userId = config.telegram.adminUserId;
        for (const diff of diffs) {
          const diffText = `@@ -0,0 +1,${diff.additions + diff.deletions} @@\n` +
            Array(diff.deletions).fill(0).map(() => "-").join("\n") + "\n" +
            Array(diff.additions).fill(0).map(() => "+").join("\n");
          void fileDiffLogger.logDiff(userId, sessionId, diff.file, diffText);
        }
      }
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        await pinnedMessageManager.onSessionDiff(diffs);
      } catch (err) {
        logger.error("[Bot] Error updating session diff:", err);
      }
    });
  });

  summaryAggregator.setOnFileChange((sessionId, change) => {
    const scope = threadContextManager.getSessionScope(sessionId);
    if (!scope) {
      return;
    }
    runWithTelegramConversationScope(scope, () => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }
      pinnedMessageManager.addFileChange(change);
    });
  });

  pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit) => {
    try {
      logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
      keyboardManager.updateContext(tokensUsed, tokensLimit);
      // Don't send automatic keyboard updates - keyboard will update naturally with user messages
    } catch (err) {
      logger.error("[Bot] Error updating keyboard context:", err);
    }
  });

  logger.warn(`[Bot] ensureEventSubscription: directory=${directory}`);
  subscribeToEvents(directory, (event) => {
    if (!((event as { type: string }).type === "server.heartbeat" || (event as { type: string }).type === "server.connected")) {
      logger.debug(`[Bot] SSE event: type=${(event as {type:string}).type}`, event);
    }
    if ((event as { type: string }).type === "server.heartbeat") {
      void reconcileBusyState(directory);
    }

    if (event.type === "message.part.updated") {
      const part = (
        event.properties as {
          part?: {
            sessionID?: string;
            messageID?: string;
            id?: string;
            type?: string;
            text?: string;
          };
        }
      ).part;
      if (
        part?.sessionID &&
        part.messageID &&
        part.id &&
        part.type === "text" &&
        typeof part.text === "string" &&
        isManagedChildSession(part.sessionID)
      ) {
        setChildAssistantTextPart(part.sessionID, part.messageID, part.id, part.text);
        childSessionLastMessage.set(part.sessionID, part.text);
      }

      if (
        part?.sessionID &&
        part.messageID &&
        part.id &&
        part.type === "reasoning" &&
        typeof part.text === "string" &&
        isManagedChildSession(part.sessionID)
      ) {
        const sessionId = part.sessionID;
        const msgId = part.messageID;
        childReasoningBuffer.set(sessionId, { messageId: msgId, text: part.text });
        childSessionLastMessage.set(sessionId, part.text);
      }

      if (
        part?.sessionID &&
        part.messageID &&
        part.id &&
        part.type === "text" &&
        typeof part.text === "string" &&
        isManagedChildSession(part.sessionID)
      ) {
        const bufKey = part.sessionID;
        const buffered = childReasoningBuffer.get(bufKey);
        if (buffered && buffered.messageId && buffered.text) {
          const reasoningText = buffered.text;
          childReasoningBuffer.delete(bufKey);

          safeBackgroundTask({
            taskName: `child-reasoning-flush.${bufKey}`,
            task: async () => {
              const target = getSessionDeliveryTarget(bufKey);
              const botApi = getSessionRoutingApi(bufKey);
              if (!botApi || !target) return;

              const formatted = formatReasoningBlock(reasoningText);
              const chunks = splitTextIntoChunks(formatted, TELEGRAM_MESSAGE_LIMIT);
              for (const chunk of chunks) {
                await deliverChildTopicMessage(childTopicDeliveryDependencies, {
                  sessionId: bufKey,
                  kind: "diagnostic",
                  text: chunk,
                  format: "html",
                });
              }
            },
          });
        }
      }

      // 2026-05-09: Subagent tool events are now delivered through the aggregator's
      // setOnTool → formatTechnicalProgressSync/WithDetails pipeline, which produces
      // localized, Telegraph-linked messages consistent with the main chat style.
      // The old raw JSON diagnostic path here was a duplication source.
    }

    if (event.type === "message.updated") {
      const info = (
        event.properties as {
          info?: {
            id?: string;
            sessionID?: string;
            role?: string;
            time?: { completed?: number };
          };
        }
      ).info;
      if (
        info?.sessionID &&
        info.role === "assistant" &&
        !info.time?.completed &&
        isManagedChildSession(info.sessionID)
      ) {
        const startSessionId = info.sessionID;
        const pendingRoutingSetup = pendingChildRoutingSetupBySessionId.get(startSessionId);
        const routingReady = pendingRoutingSetup
          ? pendingRoutingSetup.then(() => true).catch(() => false)
          : Promise.resolve(true);

        safeBackgroundTask({
          taskName: `child-typing.${startSessionId}`,
          task: async () => {
            if (!(await routingReady)) return;
            const target = getSessionDeliveryTarget(startSessionId);
            const botApi = getSessionRoutingApi(startSessionId);
            if (!botApi || !target) return;

            const doTyping = () => {
              botApi
                .sendChatAction(target.chatId, "typing", {
                  message_thread_id: target.messageThreadId,
                })
                .catch(() => {});
            };

            doTyping();

            if (!childTypingIntervals.has(startSessionId)) {
              const interval = setInterval(doTyping, 5000);
              childTypingIntervals.set(startSessionId, interval);
            }
          },
        });
      }

      if (
        info?.sessionID &&
        info.id &&
        info.role === "assistant" &&
        typeof info.time?.completed === "number" &&
        isManagedChildSession(info.sessionID) &&
        markChildAssistantDelivered(info.sessionID, info.id)
      ) {
        const childSessionId = info.sessionID;
        const childMessageId = info.id;
        const childCompletedAt = info.time.completed;
        void enqueueSessionCompletionTask(childSessionId, async () => {
          const pendingDeletionTerminalStatus =
            childAssistantMessagesBySessionId.get(childSessionId)?.get(childMessageId)
              ?.pendingDeletionTerminalStatus ?? null;
          const pendingRoutingSetup = pendingChildRoutingSetupBySessionId.get(childSessionId);
          if (pendingRoutingSetup) {
            await pendingRoutingSetup.catch(() => false);
          }

          const childText = getCombinedChildAssistantText(childSessionId, childMessageId).trim();
          const msgInfo = info as { tokens?: { input?: number; output?: number } };
          if (msgInfo.tokens) {
            const meta = childSessionMeta.get(childSessionId);
            if (meta) {
              meta.tokens.input = Math.max(meta.tokens.input, msgInfo.tokens.input ?? 0);
              meta.tokens.output = Math.max(meta.tokens.output, msgInfo.tokens.output ?? 0);
            }
          }

          if (childText) {
            const botApi = getSessionRoutingApi(childSessionId);
            if (botApi) {
              const childFormat =
                getAssistantParseMode() === "MarkdownV2" ? "markdown_v2" : ("raw" as const);
              let childDeliverySucceeded = false;
              const finalChildDelivery = finalAssistantDeliveryOrchestrator.enqueue({
                sessionId: childSessionId,
                channel: "durable",
                eventTimeMs: childCompletedAt,
                logicalMessageId: childMessageId,
                deliver: async () => {
                  const target = getSessionDeliveryTarget(childSessionId);
                  if (!target) {
                    return;
                  }

                  try {
                    await botApi.sendChatAction(target.chatId, "typing", {
                      message_thread_id: target.messageThreadId,
                    });
                  } catch {
                    // Typing is best-effort
                  }

                  for (const part of renderChildAssistantFinalParts(childText, childFormat)) {
                    await deliverChildTopicMessage(childTopicDeliveryDependencies, {
                      sessionId: childSessionId,
                      kind: "live_text",
                      text: part.text,
                      rawFallbackText: part.fallbackText,
                      format: childFormat,
                      options: part.entities?.length ? { entities: part.entities } : undefined,
                    });
                  }
                },
              });

              await finalAssistantDeliveryOrchestrator.flushSession(childSessionId);
              await finalChildDelivery
                .then(async () => {
                  childDeliverySucceeded = true;
                  childTopicDeletionBlockedSessions.delete(childSessionId);

                  const typingInterval = childTypingIntervals.get(childSessionId);
                  if (typingInterval) {
                    clearInterval(typingInterval);
                    childTypingIntervals.delete(childSessionId);
                  }

                  // Unpin topic on completion
                  const pinnedId = childTopicPinnedMessageId.get(childSessionId);
                  if (pinnedId) {
                    safeBackgroundTask({
                      taskName: `child-unpin.${childSessionId}`,
                      task: async () => {
                        const botApi = getSessionRoutingApi(childSessionId);
                        const target = getSessionDeliveryTarget(childSessionId);
                        if (botApi && target) {
                          try {
                            await botApi.unpinChatMessage(target.chatId, pinnedId);
                            childTopicPinnedMessageId.delete(childSessionId);
                          } catch (error) {
                            logger.warn("[Bot] Failed to unpin subagent topic", {
                              childSessionId,
                              error,
                            });
                          }
                        }
                      },
                    });
                  }

                  // Sync topic name from OpenCode session title
                  const childScope = subagentTopicService.getScopeForSession(childSessionId);
                  if (childScope?.kind === "topic") {
                    const sessionTitle = childSessionTitle.get(childSessionId);
                    if (sessionTitle) {
                      const derivedName = deriveSubagentTopicNameFromSessionTitle(sessionTitle);
                      if (derivedName && derivedName !== childScope.topicName) {
                        const currentScope = childScope;
                        safeBackgroundTask({
                          taskName: `child-topic-sync-name.${childSessionId}`,
                          task: async () => {
                            const botApi = getSessionRoutingApi(childSessionId);
                            if (!botApi) return;
                            try {
                              await botApi.editForumTopic(
                                currentScope.chatId,
                                currentScope.messageThreadId,
                                { name: derivedName },
                              );
                              currentScope.topicName = derivedName;
                            } catch (error) {
                              logger.warn("[Bot] Failed to sync subagent topic name", {
                                childSessionId,
                                error,
                              });
                            }
                          },
                        });
                      }
                    }
                  }
                })
                .catch((error) => {
                  childDeliverySucceeded = false;
                  childTopicDeletionBlockedSessions.add(childSessionId);
                  subagentTopicService.markDeliveryCleanupPending(
                    childSessionId,
                    pendingDeletionTerminalStatus ?? "completed",
                  );
                  subagentTopicService.cancelPendingDeletion(childSessionId);
                  logger.warn("[Bot] Failed to deliver child-session assistant output", error);
                });

              if (!childDeliverySucceeded) {
                childSessionsAwaitingIdleCleanup.delete(childSessionId);
                finalAssistantDeliveryOrchestrator.clearSession(childSessionId);
                toolMessageBatcher.clearSession(childSessionId, "child_final_delivery_failed");
                toolCallStreamer.clearSession(childSessionId, "child_final_delivery_failed");
                messageDraftStreamManager.clearSession(childSessionId);
                responseStreamer.clearSession(childSessionId, "child_final_delivery_failed");
                localFileFollowUpTracker.clearSession(childSessionId);
                assistantRunState.clearRun(childSessionId, "child_final_delivery_failed");
                clearPromptResponseMode(childSessionId);
                await clearThinkingBlockStream(childSessionId, false);
                foregroundSessionState.markIdle(
                  childSessionId,
                  getBusyScopeForSession(childSessionId),
                );
                await scheduledTaskRuntime.flushDeferredDeliveries();
                return;
              }

              if (pendingDeletionTerminalStatus) {
                await deliverChildTopicTerminalFooterAndConfirmDelivery(
                  childSessionId,
                  pendingDeletionTerminalStatus,
                );
              }
            }
          }

          if (childSessionsAwaitingIdleCleanup.has(childSessionId)) {
            childSessionsAwaitingIdleCleanup.delete(childSessionId);
            await handleSessionIdle(childSessionId, { skipPendingCompletionWait: true });
          }

          const sessionMessages = childAssistantMessagesBySessionId.get(childSessionId);
          sessionMessages?.delete(childMessageId);
          if (sessionMessages && sessionMessages.size === 0) {
            childAssistantMessagesBySessionId.delete(childSessionId);
          }
        }).catch((error) => {
          logger.warn("[Bot] Child-session completion task failed", error);
        });
      }
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      const info = (
        event.properties as {
          info?: {
            id?: string;
            parentID?: string;
            title?: string;
            directory?: string;
            time?: { updated?: number };
          };
        }
      ).info;

      if (info?.directory) {
        safeBackgroundTask({
          taskName: `session.cache.${event.type}`,
          task: () => ingestSessionInfoForCache(info),
        });
      }

      if (info?.id && info.title) {
        childSessionTitle.set(info.id, info.title);
      }

      // Rename forum topic for ROOT sessions (not just child/subagent sessions)
      if (
        typeof info?.id === "string" &&
        typeof info.title === "string" &&
        (!info.parentID || info.parentID === info.id)
      ) {
        const deliveryTarget = getSessionDeliveryTarget(info.id);
        // Only sessions delivered into a forum topic carry a messageThreadId;
        // TelegramDeliveryTarget has no discriminant, so the presence of a numeric
        // thread id is what tells us this root session lives in a renamable topic.
        const topicThreadId = deliveryTarget?.messageThreadId;
        if (deliveryTarget && typeof topicThreadId === "number") {
          const truncated = info.title.length > 128 ? info.title.slice(0, 125) + "..." : info.title;
          // Skip SSE-driven rename if command handler already renamed to this value
          const lastSet = childTopicLastSetName.get(info.id);
          if (lastSet === truncated) return;
          safeBackgroundTask({
            taskName: `root-topic-rename.${info.id}`,
            task: async () => {
              const botApi = getSessionRoutingApi(info.id!);
              if (!botApi) return;
              try {
                await botApi.editForumTopic(deliveryTarget.chatId, topicThreadId, {
                  name: truncated,
                });
                childTopicLastSetName.set(info.id!, truncated);
              } catch (error) {
                logger.warn("[Bot] Failed to sync root session topic name", {
                  sessionId: info.id,
                  error,
                });
              }
            },
          });
        }
      }

      if (
        typeof info?.id === "string" &&
        typeof info.parentID === "string" &&
        info.parentID !== info.id
      ) {
        const topicName = deriveSubagentTopicNameFromSessionTitle(info.title);
        const childScope = subagentTopicService.getScopeForSession(info.id);

        if (childScope?.kind === "topic" && topicName && info.id) {
          const existingTopicName = childScope.topicName;
          if (existingTopicName && existingTopicName !== topicName) {
            const currentScope = childScope;
            const childId = info.id;

            safeBackgroundTask({
              taskName: `child-topic-rename.${childId}`,
              task: async () => {
                const botApi = getSessionRoutingApi(childId);
                if (!botApi) return;
                try {
                  await botApi.editForumTopic(currentScope.chatId, currentScope.messageThreadId, {
                    name: topicName,
                  });
                  currentScope.topicName = topicName;
                } catch (error) {
                  logger.warn("[Bot] Failed to sync subagent topic name", {
                    childSessionId: childId,
                    error,
                  });
                }
              },
            });
          }
          return;
        }

        if (!isManagedChildSession(info.id)) {
          seedChildRoutingFromSubagent({
            parentSessionId: info.parentID,
            childSessionId: info.id,
            topicName,
          });

          const routingSetup = syncSubagentDeliverySerialized({
            childSessionId: info.id,
            parentSessionId: info.parentID,
            topicName,
          });
          pendingChildRoutingSetupBySessionId.set(info.id, routingSetup);
          void routingSetup.finally(() => {
            if (pendingChildRoutingSetupBySessionId.get(info.id!) === routingSetup) {
              pendingChildRoutingSetupBySessionId.delete(info.id!);
            }
          });
        }
      }
    }

    if (event.type === "message.updated") {
      const info = (
        event.properties as {
          info?: {
            id?: string;
            sessionID?: string;
            role?: string;
            parts?: Array<{ type?: string; text?: string }>;
          };
        }
      ).info;

      const sessionId = info?.sessionID;
      const messageId = info?.id;
      if (sessionId && messageId && info?.role === "user") {
        const scope = attachManager.getScopeForSession(sessionId);
        const target = scope ? attachManager.getTargetForSession(sessionId) : null;
        const text = extractExternalUserInputText(
          event as { properties?: { info?: { parts?: Array<{ type?: string; text?: string }> } } },
        );

        if (
          scope &&
          target &&
          text &&
          !externalInputSuppression.shouldSuppress(sessionId, scope, text) &&
          shouldDeliverExternalInputNotification({ sessionId, scope, messageId })
        ) {
          void runWithTelegramConversationScope(scope, async () => {
            await activeBotInstance?.api.sendMessage(
              target.chatId,
              formatExternalUserInputMessage(text, t("bot.external_user_input")),
              withMessageThreadId(undefined, target.messageThreadId),
            );
          }).catch((error) => {
            logger.warn("[Bot] Failed to send external user input notification", error);
          });
        }
      }
    }

    // 2026-05-29: session.diff → child topic delivery removed.
    // These messages duplicated tool completion notifications that already arrive
    // via the standard setOnTool path. The cumulative nature of session.diff events
    // caused massive repetition in subagent topics.

    if (config.bot.trackBackgroundSessions) {
      try {
        backgroundSessionTracker.processEvent(event, getCurrentSession()?.id ?? null);
      } catch (err) {
        logger.error("[Bot] backgroundSessionTracker.processEvent failed:", err);
      }
    }

    summaryAggregator.processEvent(event);
  }).catch((err) => {
    logger.error("Failed to subscribe to events:", err);
  });
}

export function createBot(): Bot<Context> {
  backgroundSessionTracker.clear();
  clearAllInteractionState("bot_startup");
  setUserLocaleResolver(getUserLocale);
  subagentTopicService.clearAll();
  managedChildSessionIds.clear();
  childAssistantMessagesBySessionId.clear();
  pendingChildRoutingSetupBySessionId.clear();
  childSessionsAwaitingIdleCleanup.clear();
  childTopicDeletionBlockedSessions.clear();

  const botOptions = createTelegramBotOptions(config.telegram);

  const bot = new Bot(config.telegram.token, botOptions);
  activeBotInstance = bot;

  summaryAggregator.setOnMessageRemoved(async (sessionId, messageId) => {
    const repo = getMessageJournalRepo();
    const rows = repo.findByOcMessage(sessionId, messageId);
    for (const row of rows) {
      try {
        await bot.api.deleteMessage(row.tg_chat_id, row.tg_message_id);
        repo.deleteByTgMessage(row.tg_message_id, row.tg_chat_id, row.tg_topic_id);
      } catch (err) {
        logger.warn(`[MessageJournal] Failed to delete TG message:`, err);
      }
    }
  });

  summaryAggregator.setOnSessionDeleted(async (sessionId) => {
    const repo = getMessageJournalRepo();
    const rows = repo.findByOcSession(sessionId);
    const topicGroups = new Map<
      string,
      { chatId: number; topicId: number | null; messageIds: number[] }
    >();
    for (const row of rows) {
      const key = `${row.tg_chat_id}:${row.tg_topic_id}`;
      if (!topicGroups.has(key)) {
        topicGroups.set(key, {
          chatId: row.tg_chat_id,
          topicId: row.tg_topic_id,
          messageIds: [],
        });
      }
      topicGroups.get(key)!.messageIds.push(row.tg_message_id);
    }
    for (const [, group] of topicGroups) {
      const allTopicMsgs = repo.findByTgTopic(group.chatId, group.topicId);
      const onlyThisSession = allTopicMsgs.every((r) => r.oc_session_id === sessionId);
      if (onlyThisSession && group.topicId != null) {
        try {
          await bot.api.deleteForumTopic(group.chatId, group.topicId);
        } catch (err) {
          logger.warn(`[MessageJournal] Failed to delete forum topic:`, err);
          for (const msgId of group.messageIds) {
            await bot.api.deleteMessage(group.chatId, msgId).catch(() => {});
          }
        }
      } else {
        for (const msgId of group.messageIds) {
          await bot.api.deleteMessage(group.chatId, msgId).catch(() => {});
        }
      }
    }
    repo.deleteByOcSession(sessionId);
  });

  loadTerminalTopics().catch(() => {});
  keyboardManager.startAutoUpdate();

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  setInterval(() => {
    heartbeatCounter++;
    if (heartbeatCounter % 6 === 0) {
      // Log every 30 seconds (5 sec * 6)
      logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
    }
  }, 5000);

  // Disable link previews for all outgoing text messages
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "sendMessage" || method === "editMessageText") {
      const p = payload as Record<string, unknown>;
      if (!p.link_preview_options) {
        p.link_preview_options = { is_disabled: true };
      }
    }
    return prev(method, payload, signal);
  });

  // Log all API calls for diagnostics
  let lastGetUpdatesTime = Date.now();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "getUpdates") {
      const now = Date.now();
      const timeSinceLast = now - lastGetUpdatesTime;
      logger.debug(`[Bot API] getUpdates called (${timeSinceLast}ms since last)`);
      lastGetUpdatesTime = now;
      return prev(method, payload, signal);
    }

    if (method === "sendMessage") {
      const mtid = (payload as { message_thread_id?: number }).message_thread_id;
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id} threadId=${mtid ?? "none"}`);
    }

    return withTelegramRateLimitRetry(() => prev(method, payload, signal), {
      maxRetries: 5,
      onRetry: ({ attempt, retryAfterMs, error }) => {
        logger.warn(
          `[Bot API] Telegram rate limit on ${method}, retrying in ${retryAfterMs}ms (attempt=${attempt})`,
          error,
        );
      },
    });
  });

  bot.use((ctx, next) => {
    const hasCallbackQuery = !!ctx.callbackQuery;
    const hasMessage = !!ctx.message;
    const callbackData = ctx.callbackQuery?.data || "N/A";
    logger.debug(
      `[DEBUG] Incoming update: hasCallbackQuery=${hasCallbackQuery}, hasMessage=${hasMessage}, callbackData=${callbackData}`,
    );
    return next();
  });

  bot.use(authMiddleware);
  bot.use(ensureCommandsInitialized);
  bot.use((ctx, next) => {
    const scope = extractTelegramConversationScopeFromContext(ctx);
    return runWithTelegramConversationScope(scope, () => {
      threadContextManager.activateFromContext(ctx);
      if (scope && scope.messageThreadId && isTerminalTopic(scope.messageThreadId)) {
        keyboardManager.initialize(ctx.api, scope.chatId);
        keyboardManager.setSessionMode(SessionType.TERMINAL);
      }
      if (scope) {
        const activeSession = getCurrentSession();
        writeCurrentContext({
          chatId: scope.chatId,
          messageThreadId: scope.messageThreadId ?? null,
          sessionId: activeSession?.id ?? "unknown",
          timestamp: Date.now(),
        });
      }
      return next();
    });
  });
  bot.use(interactionGuardMiddleware);

  // Intercept API key / OAuth callback input after scope is set
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text?.trim();
    const userId = ctx.from?.id;
    if (userId && text && text.length < 500) {
      if (isAnyProviderPrompt(userId)) {
        await handleProviderInput(ctx, text);
        return;
      }
    }
    await next();
  });

  const blockMenuWhileInteractionActive = async (ctx: Context): Promise<boolean> => {
    const activeInteraction = interactionManager.getSnapshot();
    if (!activeInteraction) {
      return false;
    }

    if (activeInteraction.kind === "inline" && interactionManager.isExpired()) {
      logger.warn(
        `[Bot] Clearing expired inline interaction before opening menu: metadata=${JSON.stringify(activeInteraction.metadata)}, createdAt=${activeInteraction.createdAt}, expiresAt=${activeInteraction.expiresAt}`,
      );
      interactionManager.clear("expired_inline_menu_before_open");
      return false;
    }

    logger.warn(
      `[Bot] Blocking menu open while interaction active: kind=${activeInteraction.kind}, expectedInput=${activeInteraction.expectedInput}, metadata=${JSON.stringify(activeInteraction.metadata)}, createdAt=${activeInteraction.createdAt}, expiresAt=${activeInteraction.expiresAt}`,
    );
    await ctx.reply(t("interaction.blocked.finish_current"));
    return true;
  };

  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("status", statusCommand);
  bot.command("stream", streamCommand);
  bot.command("restart", restartCommand);
  bot.command("tts", ttsCommand);
  bot.command("terminal", terminalCommand);
  bot.command("screen", async (ctx) => {
    const mtId = ctx.message?.message_thread_id;
    if (!isTerminalTopic(mtId)) {
      await ctx.reply("This command only works in a terminal topic.");
      return;
    }
    await takeTerminalScreenshot(mtId!, ctx.api, ctx.chat.id);
  });
  bot.command("up", async (ctx) => {
    const mtId = ctx.message?.message_thread_id;
    if (!isTerminalTopic(mtId)) return;
    await handleTerminalScrollButton("up", mtId!, ctx.api, ctx.chat.id);
  });
  bot.command("down", async (ctx) => {
    const mtId = ctx.message?.message_thread_id;
    if (!isTerminalTopic(mtId)) return;
    await handleTerminalScrollButton("down", mtId!, ctx.api, ctx.chat.id);
  });
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", opencodeStopCommand);
  bot.command("projects", projectsCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("model", modelCommand);
  bot.command("variant", variantCommand);
  bot.command("compact", compactCommand);
  bot.command("settings", settingsCommand);
  bot.command("new", newCommand);
  bot.command("abort", abortCommand);
  bot.command("detach", detachCommand);

  bot.command("share", shareCommand);
  bot.command("unshare", unshareCommand);
  bot.command("fork", forkCommand);
  bot.command("revert", revertCommand);
  bot.command("del", deleteMessageCommand);
  bot.command("memory", memoryCommand);
  bot.command("server", serverWebCommand);
  bot.command("connect", connectCommand);
  bot.command("task", taskCommand);
  bot.command("tasklist", taskListCommand);
  bot.command("rename", renameCommand);
  bot.command("commands", commandsCommand);
  bot.command("worktree", worktreeCommand);
  bot.command("open", openCommand);
  bot.command("ls", lsCommand);
  bot.command("skills", skillsCommand);
  bot.command("mcps", mcpsCommand);
  bot.command("ssh", sshCommand);

  bot.on("message:text", unknownCommandMiddleware);

  async function handleMessageJournalFork(
    ctx: Context,
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    try {
      const session = getCurrentSession();
      if (!session) {
        await ctx.answerCallbackQuery({ text: t("edit.no_session") });
        return;
      }

      const { data, error } = await opencodeClient.session.fork({
        sessionID: sessionId,
        messageID: messageId,
        directory: session.directory,
      });

      if (error || !data) {
        if (isNotFoundError(error)) {
          logger.error(`[MjFork] Session not found on server: ${sessionId}`);
          await ctx.answerCallbackQuery({ text: t("fork.session_not_found") });
          return;
        }
        logger.error("[MjFork] Fork failed:", error);
        await ctx.answerCallbackQuery({ text: t("fork.error") });
        return;
      }

      const forked = data as { id: string; title: string };
      const chatId = ctx.chat!.id;
      const topicName = `[Fork] ${forked.title}`;
      const newTopic = await ctx.api.createForumTopic(chatId, topicName);

      const activeScope = threadContextManager.getActiveScope();
      if (activeScope) {
        await attachSessionForScope({
          scope: { ...activeScope, messageThreadId: newTopic.message_thread_id },
          session: {
            id: forked.id,
            title: forked.title,
            directory: session.directory,
          },
          reason: "fork",
        });

        setCurrentSession({ ...session });
      }

      await ctx.answerCallbackQuery();
    } catch (err) {
      if (isNotFoundError(err)) {
        logger.error(`[MjFork] Session not found on server (thrown): ${sessionId}`);
        await ctx.answerCallbackQuery({ text: t("fork.session_not_found") });
        return;
      }
      logger.error("[MjFork] Error:", err);
      await ctx.answerCallbackQuery({ text: t("fork.error") });
    }
  }

  async function handleMessageJournalRevert(
    ctx: Context,
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    try {
      const session = getCurrentSession();
      if (!session) {
        await ctx.answerCallbackQuery({ text: t("edit.no_session") });
        return;
      }

      const { error } = await opencodeClient.session.revert({
        sessionID: sessionId,
        messageID: messageId,
        directory: session.directory,
      });

      if (error) {
        logger.error("[MjRevert] Revert failed:", error);
        await ctx.answerCallbackQuery({ text: t("fork.error") });
        return;
      }

      await ctx.answerCallbackQuery();
    } catch (err) {
      logger.error("[MjRevert] Error:", err);
      await ctx.answerCallbackQuery({ text: t("fork.error") });
    }
  }

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    try {
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      if (handledInlineCancel) {
        clearOpenPathIndex();
        clearLsPathIndex();
      }
      // Terminal scroll buttons (data format: "term:up:123" or "term:down:123" or "term:refresh:123")
      const data = ctx.callbackQuery?.data ?? "";
      if (data.startsWith("term:")) {
        const parts = data.split(":");
        if (parts[1] === "key") {
          // term:key:<mtId>:<keyName>
          const mtId = parseInt(parts[2]);
          const key = parts[3];
          const session = getPtySession(mtId);
          if (session) {
            const keyMap: Record<string, string> = {
              up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D",
              enter: "\r", tab: "\t", esc: "\x1b",
            };
            session.write(keyMap[key] ?? "\r");
          }
        } else {
          // term:<action>:<mtId>
          const action = parts[1] as "up" | "down" | "refresh";
          const mtId = parseInt(parts[2]);
          await handleTerminalScrollButton(action, mtId, ctx.api, ctx.chat!.id);
        }
        await ctx.answerCallbackQuery();
        return;
      }
      const handledSsh = await handleSshCallback(ctx);
      if (handledSsh) {
        return;
      }
      const handledSession = await handleSessionSelect(ctx);
      const handledBackgroundSession = await handleBackgroundSessionOpen(ctx);
      const handledProject = await handleProjectSelect(ctx, { ensureEventSubscription });
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledAccessApproval = await handleAccessApprovalCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      if (ctx.callbackQuery?.data === "model:add_provider") {
        await connectCommand(ctx);
        await ctx.answerCallbackQuery().catch(() => {});
        return;
      }
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledTask = await handleTaskCallback(ctx);
      const handledTaskList = await handleTaskListCallback(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);
      const handledCommands = await handleCommandsCallback(ctx, { bot, ensureEventSubscription });
      const handledSettings = await handleSettingsCallback(ctx);
      const handledWorktree = await handleWorktreeCallback(ctx, { ensureEventSubscription });
      const handledOpen = await handleOpenCallback(ctx, { ensureEventSubscription });
      const handledLs = await handleLsCallback(ctx);
      const handledSkills = await handleSkillsCallback(ctx, { bot, ensureEventSubscription });
      const handledMcps = await handleMcpsCallback(ctx);
      const handledServerCb = await handleServerCallback(ctx);
      const handledOnboarding = await handleWebOnboardingCallback(ctx) || await handleOnboardingCallback(ctx);
      const callbackData = ctx.callbackQuery?.data ?? "";

      let handledMjFork = false;
      let handledMjRevert = false;
      if (callbackData.startsWith("mj_fork_")) {
        const [, , sessionId, messageId] = callbackData.split("_");
        handleMessageJournalFork(ctx, sessionId, messageId);
        handledMjFork = true;
      }
      if (callbackData.startsWith("mj_revert_")) {
        const [, , sessionId, messageId] = callbackData.split("_");
        handleMessageJournalRevert(ctx, sessionId, messageId);
        handledMjRevert = true;
      }
      let handledConnect = false;
      if (callbackData === "connect:cancel") {
        clearActiveInlineMenu("connect_cancel");
        await ctx.reply(t("inline.cancelled_callback"));
        await ctx.answerCallbackQuery();
        return;
      }
      const providerStartMatch = /^provider:start:(.+):(\d+)$/.exec(callbackData);
      if (providerStartMatch) {
        const pid = providerStartMatch[1];
        const idx = parseInt(providerStartMatch[2], 10);
        await startProviderAuth(ctx, pid, idx);
        await ctx.answerCallbackQuery().catch(() => {});
        return;
      }

      const providerAuthMatch = /^provider:auth:(.+)$/.exec(callbackData);
      if (providerAuthMatch) {
        const providerId = providerAuthMatch[1];
        await handleProviderAuth(ctx, providerId);
        await ctx.answerCallbackQuery();
        handledConnect = true;
      }

      logger.debug(
        `[Bot] Callback handled: inlineCancel=${handledInlineCancel}, session=${handledSession}, backgroundSession=${handledBackgroundSession}, project=${handledProject}, question=${handledQuestion}, accessApproval=${handledAccessApproval}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, task=${handledTask}, taskList=${handledTaskList}, rename=${handledRenameCancel}, commands=${handledCommands}, settings=${handledSettings}, worktree=${handledWorktree}, open=${handledOpen}, ls=${handledLs}, skills=${handledSkills}, mcps=${handledMcps}, serverCb=${handledServerCb}, onboarding=${handledOnboarding}, connect=${handledConnect}`,
      );

      if (
        !handledInlineCancel &&
        !handledSession &&
        !handledBackgroundSession &&
        !handledProject &&
        !handledQuestion &&
        !handledAccessApproval &&
        !handledPermission &&
        !handledAgent &&
        !handledModel &&
        !handledVariant &&
        !handledCompactConfirm &&
        !handledTask &&
        !handledTaskList &&
        !handledRenameCancel &&
        !handledCommands &&
        !handledSettings &&
        !handledWorktree &&
        !handledOpen &&
        !handledLs &&
        !handledSkills &&
        !handledMcps &&
        !handledServerCb &&
        !handledOnboarding &&
        !handledConnect &&
        !handledMjFork &&
        !handledMjRevert
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      clearAllInteractionState(
        "callback_handler_error",
        buildTelegramConversationScopeKey(extractTelegramConversationScopeFromContext(ctx)),
      );
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });

  // Handle Reply Keyboard button press (agent mode indicator)
  bot.hears(AGENT_MODE_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Agent mode button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await cycleAgentMode(ctx);
    } catch (err) {
      logger.error("[Bot] Error cycling agent mode:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  // Handle Reply Keyboard button press (model selector)
  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showModelSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  // Handle Reply Keyboard button "Stop"
  bot.hears(STOP_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Stop button pressed: ${ctx.message?.text}`);

    try {
      // If in a terminal topic, abort the session and kill any local process
      const mtId = ctx.message?.message_thread_id;
      if (mtId !== undefined && isTerminalTopic(mtId)) {
        killTerminalProcess(mtId);
        await abortCurrentOperation(ctx, { notifyUser: false }).catch(() => {});
        await keyboardManager.sendKeyboardUpdate().catch(() => {});
        await ctx.reply("⏹ Stopped.");
        return;
      }

      if (!processManager.isRunning()) {
        await ctx.reply(t("opencode_stop.not_running"));
        return;
      }

      const pid = processManager.getPID();
      const statusMsg = await ctx.reply(
        t("opencode_stop.stopping", { pid: pid ?? "-" }),
      );

      const { success, error } = await processManager.stop(5000);

      if (!success) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          t("opencode_stop.stop_error", { error: error || t("common.unknown_error") }),
        );
        return;
      }

      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        t("opencode_stop.success"),
      );

      keyboardManager.updateRunningStatus(false);
    } catch (err) {
      logger.error("[Bot] Error on stop button:", err);
      await ctx.reply(t("opencode_stop.error"));
    }
  });

  // Handle Reply Keyboard button "New Window"
  bot.hears(NEW_WINDOW_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] New window button pressed: ${ctx.message?.text}`);

    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply(t("error.user_not_found"));
        return;
      }

      const forumChatId = threadContextManager.findForumChatIdForUser(userId);
      if (!forumChatId) {
        await ctx.reply(t("background.forum_not_found"));
        return;
      }

      await openTerminalTopic(ctx.api, userId, forumChatId);

      await ctx.reply(t("keyboard.new_window_created"));
    } catch (err) {
      logger.error("[Bot] Error creating new window:", err);
      await ctx.reply(t("error.generic"));
    }
  });

  // Handle Reply Keyboard system info button – open file manager
  bot.hears(/^🖥\s/, async (ctx) => {
    logger.debug(`[Bot] System info button pressed, opening /ls`);
    await lsCommand(ctx as any);
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text;
    if (text) {
      const isCommand = text.startsWith("/");
      logger.debug(
        `[Bot] Received text message: ${isCommand ? `command="${text}"` : `prompt (length=${text.length})`}, chatId=${ctx.chat.id}`,
      );
    }
    await next();
  });

  // Remove any previously set global commands to prevent unauthorized users from seeing them
  safeBackgroundTask({
    taskName: "bot.clearGlobalCommands",
    task: async () => {
      try {
        await Promise.all([
          bot.api.setMyCommands([], { scope: { type: "default" } }),
          bot.api.setMyCommands([], { scope: { type: "all_private_chats" } }),
        ]);
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        logger.debug("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  // Deferred media batch for correlating follow-up messages into a single prompt
  deferredBatch = new IncomingMediaBatch<
    ResolvedDeferredItem,
    ResolvedDeferredItem,
    DeferredPromptBatchResolution
  >({
    correlationWindowMs: 3000,
    maxWindowMs: 3000,
    canFlushNow: async () => {
      const session = getCurrentSession();
      if (!session) return true;
      return !(await isSessionBusy(session.id, session.directory));
    },
    sendDirectPrompt: async () => {},
    resolveDeferredItems: async ({ deferredItems }) => {
      const result = composeDeferredMediaPrompt(deferredItems, t as (key: string) => string);
      const parts: string[] = [];
      if (result.directText) parts.push(result.directText);
      if (result.contextText) parts.push(result.contextText);
      return {
        text: parts.join("\n\n"),
        firstContext: deferredItems.find((item) => item.ctx)?.ctx,
      };
    },
    sendDeferredFollowUp: async ({ resolvedDeferredItems }) => {
      const { text, firstContext } = resolvedDeferredItems;
      try {
        if (firstContext) {
          const promptDeps = { bot, ensureEventSubscription, deferredBatch };
          await processUserPrompt(firstContext, text, promptDeps, [], { isFollowUpBatch: true });
          return;
        }

        const session = getCurrentSession();
        if (!session) return;
        await opencodeClient.session.promptAsync({
          sessionID: session.id,
          directory: session.directory,
          parts: [{ type: "text", text }],
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (msg.includes("cooling down") || msg.includes("VM creation recently failed")) {
          logger.debug("[Bot] VM cooldown active, skipping batch retry");
          return;
        }
        throw err;
      }
    },
  });

  // Voice and audio message handlers (STT transcription -> prompt)
  const buildVoicePromptDeps = (ctx: Context) => {
    const scopeKey = buildTelegramConversationScopeKey(
      extractTelegramConversationScopeFromContext(ctx),
    );

    return {
      bot,
      ensureEventSubscription,
      deferredBatch,
      acquireProcessingHold: () => deferredBatch.acquireProcessingHold(scopeKey),
      enqueueCorrelatedItem: (item: ResolvedDeferredItem) =>
        deferredBatch.enqueueDeferredItem({
          scopeKey,
          deferredItem: item,
        }),
    };
  };

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    await handleVoiceMessage(ctx, buildVoicePromptDeps(ctx));
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    await handleVoiceMessage(ctx, buildVoicePromptDeps(ctx));
  });

  bot.on("message", createMediaGroupAttachmentMiddleware({ bot, ensureEventSubscription }));

  // Photo message handler
  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);

    const photoScopeKey = buildTelegramConversationScopeKey(
      extractTelegramConversationScopeFromContext(ctx),
    );

    await handlePhotoMessage(ctx, {
      bot,
      ensureEventSubscription,
      deferredBatch,
      enqueueCorrelatedItem: (item) =>
        deferredBatch.enqueueDeferredItem({
          scopeKey: photoScopeKey,
          deferredItem: item,
        }),
      acquireProcessingHold: () => deferredBatch.acquireProcessingHold(photoScopeKey),
    });
  });

  // Document message handler (PDF and text files)
  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);

    const docScopeKey = buildTelegramConversationScopeKey(
      extractTelegramConversationScopeFromContext(ctx),
    );

    const deps = {
      bot,
      ensureEventSubscription,
      deferredBatch,
      enqueueCorrelatedItem: (item: ResolvedDeferredItem) =>
        deferredBatch.enqueueDeferredItem({
          scopeKey: docScopeKey,
          deferredItem: item,
        }),
      acquireProcessingHold: () => deferredBatch.acquireProcessingHold(docScopeKey),
    };
    await handleDocumentMessage(ctx, deps);
  });

  bot.on(["message:video", "message:video_note"], async (ctx) => {
    logger.debug(`[Bot] Received video message, chatId=${ctx.chat.id}`);
    const videoScopeKey = buildTelegramConversationScopeKey(
      extractTelegramConversationScopeFromContext(ctx),
    );
    const deps = {
      bot,
      ensureEventSubscription,
      deferredBatch,
      acquireProcessingHold: () => deferredBatch.acquireProcessingHold(videoScopeKey),
      enqueueCorrelatedItem: (item: ResolvedDeferredItem) =>
        deferredBatch.enqueueDeferredItem({
          scopeKey: videoScopeKey,
          deferredItem: item,
        }),
    };
    await handleVideoMessage(ctx, deps);
  });

  bot.on("message:location", async (ctx) => {
    logger.debug(`[Bot] Received location message, chatId=${ctx.chat.id}`);
    const locScopeKey = buildTelegramConversationScopeKey(
      extractTelegramConversationScopeFromContext(ctx),
    );
    const locDeps = {
      bot,
      ensureEventSubscription,
      deferredBatch,
      acquireProcessingHold: () => deferredBatch.acquireProcessingHold(locScopeKey),
      enqueueCorrelatedItem: (item: ResolvedDeferredItem) =>
        deferredBatch.enqueueDeferredItem({
          scopeKey: locScopeKey,
          deferredItem: item,
        }),
    };
    await handleLocationMessage(ctx, locDeps);
  });

  bot.on("edited_message", async (ctx) => {
    await handleEditedLocation(ctx);

    if (!ctx.editedMessage?.message_id || !ctx.editedMessage.text) return;

    const chatId = ctx.chat!.id;
    const topicId = ctx.editedMessage.message_thread_id ?? null;
    const msgId = ctx.editedMessage.message_id;

    const row = getMessageJournalRepo().findByTgMessage(msgId, chatId, topicId);
    if (!row) return;

    const session = getCurrentSession();
    if (!session) {
      await ctx.reply(t("edit.no_session"));
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(t("edit.fork_button"), `mj_fork_${row.oc_session_id}_${row.oc_message_id}`)
      .row()
      .text(t("edit.revert_button"), `mj_revert_${row.oc_session_id}_${row.oc_message_id}`);

    await ctx.reply(t("edit.fork_or_revert"), { reply_markup: keyboard });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    if (text.startsWith("/")) {
      return;
    }

    const textScopeKey = buildTelegramConversationScopeKey(
      extractTelegramConversationScopeFromContext(ctx),
    );

    if (questionManager.isActive(textScopeKey)) {
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const handledTask = await handleTaskTextInput(ctx);
    if (handledTask) {
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx);
    if (handledRename) {
      return;
    }

    const handledSshArgs = await handleSshTextArguments(ctx);
    if (handledSshArgs) {
      return;
    }

    const promptDeps = { bot, ensureEventSubscription, deferredBatch };
    const handledCommandArgs = await handleCommandTextArguments(ctx, promptDeps);
    if (handledCommandArgs) {
      return;
    }

    const handledSkillArgs = await handleSkillTextArguments(ctx, promptDeps);
    if (handledSkillArgs) {
      return;
    }

    // Terminal topic: execute as shell command, not LLM
    const mtId = ctx.message?.message_thread_id;
    if (isTerminalTopic(mtId)) {
      const handled = await handleTerminalTextInput(stripMessageTags(text), mtId!, ctx.from?.id ?? 0, {
        reply: (txt: string, opts?: any) => ctx.reply(txt, opts),
        api: ctx.api,
        chat: ctx.chat,
      });
      if (handled) return;
    }

    await processUserPrompt(ctx, text, promptDeps);

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  // Message reaction monitoring
  bot.on("message_reaction", async (ctx) => {
    const reaction = ctx.messageReaction;
    if (!reaction) return;

    const chatId = reaction.chat.id;
    const messageId = reaction.message_id;
    const userId = reaction.user?.id ?? ctx.from?.id ?? 0;

    // Extract message_thread_id: the Bot API may send it in the raw update
    // even though MessageReactionUpdated types don't include it yet.
    const rawUpdate = ctx.update as { message_reaction?: { message_thread_id?: number } };
    const rawThreadId = rawUpdate.message_reaction?.message_thread_id;
    // Fallback: look up the reacted message in the journal to find its topic
    const journalRow = rawThreadId === undefined
      ? getMessageJournalRepo().findByTgChatAndMessage(chatId, messageId)
      : null;
    const topicId = (rawThreadId ?? journalRow?.tg_topic_id ?? null);

    // Normalize emoji: strip variation selector FE0F for comparison
    const norm = (e: string) => e.replace(/\uFE0F/g, "");

    // Handle old_reaction (removed reactions) → remove bookmarks
    for (const r of reaction.old_reaction ?? []) {
      const emoji = "emoji" in r ? r.emoji : "unknown";
      const normalized = norm(emoji);

      if (normalized === "❤" || normalized === "✍") {
        getMessageBookmarksRepo().delete({
          tg_chat_id: chatId,
          tg_topic_id: topicId ?? null,
          tg_message_id: messageId,
          user_id: userId,
        });
        logger.debug(`[Bookmark] Removed ${emoji} bookmark for user ${userId}`);
      }
    }

    for (const r of reaction.new_reaction ?? []) {
      const emoji = "emoji" in r ? r.emoji : "unknown";
      const normalized = norm(emoji);

      getMessageReactionsRepo().insert({
        tg_chat_id: chatId,
        tg_topic_id: topicId ?? null,
        tg_message_id: messageId,
        user_id: userId,
        emoji,
      });

      logger.debug(`[Reaction] User ${userId} reacted ${emoji} (norm=${normalized}) on msg ${messageId}`);

      // Bookmark reactions: ❤️ or ❤ (U+2764 with/without FE0F)
      if (normalized === "❤" || normalized === "✍") {
        getMessageBookmarksRepo().upsert({
          tg_chat_id: chatId,
          tg_topic_id: topicId ?? null,
          tg_message_id: messageId,
          user_id: userId,
          emoji,
        });
        logger.info(`[Bookmark] User ${userId} bookmarked msg ${messageId} with ${emoji}`);
      }

      // 💔 → abort (admin only)
      if (normalized === "💔" && userId === config.telegram.adminUserId) {
        try {
          // Resolve messageThreadId for session matching
          const mtId = topicId != null ? topicId : undefined;

          // Find an attached session for this user in this chat and topic
          const states = attachManager.getAllStates();
          const matchingState = states.find(
            (s) =>
              s.scope.userId === userId &&
              s.scope.chatId === chatId &&
              (mtId === undefined || s.scope.messageThreadId === mtId),
          );
          let session = matchingState?.session
            ?? runWithTelegramConversationScope(
                { userId, chatId, messageThreadId: mtId },
                () => getCurrentSession(),
              );

          // Fallback: look up the session from the message journal
          if (!session) {
            const row = journalRow ?? getMessageJournalRepo().findByTgChatAndMessage(chatId, messageId);
            if (row?.oc_session_id && row.oc_project) {
              session = { id: row.oc_session_id, title: "", directory: row.oc_project };
            }
          }

          if (session) {
            await opencodeClient.session.abort({
              sessionID: session.id,
              directory: session.directory,
            }).catch(() => {});
            logger.info(`[Reaction] Admin ${userId} aborted session ${session.id} via 💔`);
          } else {
            logger.warn(`[Reaction] No session found to abort for 💔 on msg ${messageId}`);
          }
        } catch (err) {
          logger.warn(`[Reaction] Abort via 💔 failed:`, err);
        }
      }

    }
  });

  // Forum topic deletion → delete associated OpenCode sessions
  bot.on("message:forum_topic_edited", async (ctx) => {
    const topicId = ctx.message?.message_thread_id;
    if (!topicId) return;

    logger.info(`[TopicDeleted] Forum topic deleted: chatId=${ctx.chat!.id}, topicId=${topicId}`);

    const repo = getMessageJournalRepo();
    const rows = repo.findByTgTopic(ctx.chat!.id, topicId);
    const sessionIds = [...new Set(rows.map((r) => r.oc_session_id))];

    for (const sessionId of sessionIds) {
      try {
        const sessionRow = rows.find((r) => r.oc_session_id === sessionId);
        const directory = sessionRow?.oc_project ?? "";
        if (directory) {
          await opencodeClient.session.delete({ sessionID: sessionId, directory });
        }
        repo.deleteByOcSession(sessionId);
        logger.info(`[TopicDeleted] Deleted session: ${sessionId}`);
      } catch (err) {
        logger.error(`[TopicDeleted] Failed to delete session ${sessionId}:`, err);
      }
    }
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    if (err instanceof Error && err.stack) {
      logger.error("[Bot] Error stack:", err.stack);
    }
    clearAllInteractionState("bot_unhandled_error");
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });
  return bot;
}

// Exported for testing only — exposes private routing functions for unit tests.
export const __routingTest = {
  setSessionRoutingContext,
  syncSessionRoutingContext,
  getSessionRoutingContext,
  clearSessionRoutingContext,
  getSessionRoutingTarget,
  getSessionDeliveryTarget,
  getSessionRoutingApi,
  getSessionRoutingScope,
  getSessionRoutingScopeKey,
  resolveAttachedSessionTarget,
  hasLiveSessionTarget,
  isSessionCurrent,
  isSessionRoutingLiveAttached,
  cloneRoutingContextForChildSession,
  seedChildRoutingFromSubagent,
  buildThinkingRoutingIdentity,
  runWithSessionRoutingScope,
  routeTargetToScope,
  isForumScope,
  isForumParentSession,
  getBusyScopeForSession,
  syncSubagentDeliverySerialized,
  syncSubagentDeliveryContextForSession,
  tryAutoCreateSessionTopic,
  get activeBotInstance(): Bot<Context> | null {
    return activeBotInstance;
  },
  set activeBotInstance(v: Bot<Context> | null) {
    activeBotInstance = v;
  },
};
