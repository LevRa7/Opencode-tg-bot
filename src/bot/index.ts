import { Bot, Context, InputFile, NextFunction } from "grammy";
import type { Api, RawApi } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
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
  VARIANT_BUTTON_TEXT_PATTERN,
} from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect } from "./commands/sessions.js";
import { newCommand } from "./commands/new.js";
import { modelCommand } from "./commands/model.js";
import { variantCommand } from "./commands/variant.js";
import { handleSettingsCallback, settingsCommand } from "./commands/settings.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { abortCommand } from "./commands/abort.js";
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
import { streamCommand } from "./commands/stream.js";
import { ttsCommand } from "./commands/tts.js";
import { worktreeCommand, handleWorktreeCallback } from "./commands/worktree.js";
import { openCommand, handleOpenCallback, clearOpenPathIndex } from "./commands/open.js";
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
import { handlePermissionCallback, showPermissionRequest } from "./handlers/permission.js";
import { handleAgentSelect, showAgentSelectionMenu } from "./handlers/agent.js";
import { handleModelSelect, showModelSelectionMenu } from "./handlers/model.js";
import { handleVariantSelect, showVariantSelectionMenu } from "./handlers/variant.js";
import { handleContextButtonPress, handleCompactConfirm } from "./handlers/context.js";
import { handleInlineMenuCancel } from "./handlers/inline-menu.js";
import { questionManager } from "../question/manager.js";
import { interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { subscribeToEvents } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { formatToolInfo, getAssistantParseMode } from "../summary/formatter.js";
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
import { setUserLocaleResolver, t } from "../i18n/index.js";
import {
  clearPromptResponseMode,
  clearPromptRouting,
  getPromptRoutingContext,
  processUserPrompt,
  isSessionBusy,
} from "./handlers/prompt.js";
import { IncomingMediaBatch } from "./incoming-media-batch.js";
import type { ResolvedDeferredItem } from "../media/batch-types.js";
import { composeDeferredMediaPrompt } from "../media/prompt-composer.js";
import { opencodeClient } from "../opencode/client.js";
import { getCurrentSession } from "../session/manager.js";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";
import { assistantRunState } from "./assistant-run-state.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleDocumentMessage } from "./handlers/document.js";
import { handleVideoMessage } from "./handlers/video.js";
import { handlePhotoMessage } from "./handlers/photo.js";
import { finalizeAssistantResponse } from "./utils/finalize-assistant-response.js";
import { sendTtsResponseForSession } from "./utils/send-tts-response.js";
import { MessageDraftStreamManager } from "./utils/message-draft-stream.js";
import { deliverThinkingMessage } from "./utils/thinking-message.js";
import { SequentialMessageDraftIdAllocator } from "./utils/message-draft-id.js";
import {
  clearAllThinkingBlockStreams,
  clearThinkingBlockStream,
  configureThinkingBlockDraftIdAllocator,
  finalizeThinkingBlockStream,
  streamThinkingBlocks,
} from "./utils/thinking-block-stream.js";
import { formatAssistantRunFooter } from "./utils/assistant-run-footer.js";
import { sendBotText } from "./utils/telegram-text.js";
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
import {
  editMessageWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./utils/send-with-markdown-fallback.js";
import { threadContextManager } from "../thread/manager.js";
import { withMessageThreadId } from "./utils/message-thread.js";
import {
  getApprovedTelegramUserIds,
  getHideThinkingMessages,
  getHideToolCallMessages,
  getHideToolFileMessages,
  getReasoningMode,
  getTenantRuntimeInfo,
  getThinkingClearMode,
  getUserLocale,
  isMessageStreamingEnabled,
} from "../settings/manager.js";
import {
  formatReasoningForTelegramHtml,
  formatToolCallAsSpoiler,
  markdownToHtml,
} from "./utils/reasoning-format.js";
import {
  buildTelegramConversationScopeKey,
  extractTelegramConversationScopeFromContext,
  runWithTelegramConversationScope,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import { attachManager } from "../attach/manager.js";
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
  scope: TelegramConversationScope | null;
  targetSource: "attached" | "prompt";
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

function setSessionRoutingContext(sessionId: string, routing: SessionRoutingContext): void {
  routingBySessionId.set(sessionId, routing);
}

function syncSessionRoutingContext(sessionId: string): SessionRoutingContext | null {
  const promptRouting = getPromptRoutingContext(sessionId);
  if (!promptRouting) {
    return routingBySessionId.get(sessionId) ?? null;
  }

  const attachedScope = attachManager.getScopeForSession(sessionId);
  const attachedTarget = attachedScope ? attachManager.getTargetForSession(sessionId) : null;

  const routing: SessionRoutingContext = {
    bot: promptRouting.bot,
    target: attachedTarget ?? promptRouting.target,
    scope: attachedScope ?? promptRouting.scope,
    targetSource: attachedTarget ? "attached" : "prompt",
    sourceMessageId: promptRouting.sourceMessageId,
  };

  setSessionRoutingContext(sessionId, routing);
  return routing;
}

function getSessionRoutingContext(sessionId: string): SessionRoutingContext | null {
  const routing = routingBySessionId.get(sessionId);
  if (routing) {
    return routing;
  }

  return syncSessionRoutingContext(sessionId);
}

function clearSessionRoutingContext(sessionId: string): void {
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
  return resolveAttachedSessionTarget(sessionId) ?? getSessionRoutingContext(sessionId)?.target;
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

function getBusyScopeForSession(sessionId: string): TelegramConversationScope | null {
  return getSessionRoutingScope(sessionId);
}

function buildThinkingRoutingIdentity(target: {
  chatId: number;
  messageThreadId?: number;
}): string {
  return `${target.chatId}:${target.messageThreadId ?? "main"}`;
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
  if (getSessionRoutingApi(sessionId) === null) {
    return false;
  }

  if (!routing) {
    return hasLiveSessionTarget(sessionId);
  }

  if (routing.targetSource === "prompt") {
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
  target: {
    chatId: number;
    messageThreadId?: number;
  };
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
  target: { chatId: number; messageThreadId?: number },
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
  const target = getSessionRoutingTarget(sessionId);
  if (!botApi || !target || !isSessionCurrent(sessionId)) {
    return;
  }

  const deliveryRoute: LocalFileFollowUpDeliveryRoute = {
    api: botApi,
    target: {
      chatId: target.chatId,
      messageThreadId: target.messageThreadId,
    },
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
    const target = getSessionRoutingTarget(sessionId);
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
    const target = getSessionRoutingTarget(sessionId);
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
    // Ensure format and entities are propagated
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for streamed send");
    }

    const parseMode =
      format === "html" ? "HTML" : format === "markdown_v2" ? "MarkdownV2" : undefined;
    const sentMessage = await sendMessageWithMarkdownFallback({
      api: botApi,
      chatId: target.chatId,
      text,
      options,
      parseMode,
      messageThreadId: target.messageThreadId,
    });

    return sentMessage.message_id;
  },
  editText: async (sessionId, messageId, text, format, options) => {
    // Ensure format and entities are propagated
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for streamed edit");
    }

    const parseMode =
      format === "html" ? "HTML" : format === "markdown_v2" ? "MarkdownV2" : undefined;

    try {
      await editMessageWithMarkdownFallback({
        api: botApi,
        chatId: target.chatId,
        messageId,
        text,
        options,
        parseMode,
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
}: {
  botApi: Api<RawApi>;
  chatId: number;
  sessionId: string;
  finalParseMode: "html" | "raw" | "markdown_v2";
  messageThreadId?: number;
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

    await sendBotText({
      api: botApi,
      chatId,
      text: part.text,
      rawFallbackText: part.fallbackText,
      options: sendOptions as Parameters<typeof sendBotText>[0]["options"],
      format: finalParseMode,
      messageThreadId,
    });
  };
}

async function ensureEventSubscription(directory: string): Promise<void> {
  if (!directory) {
    logger.error("No directory found for event subscription");
    return;
  }

  summaryAggregator.setTypingIndicatorEnabled(true);
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
  });

  summaryAggregator.setOnPartial(
    async (sessionId, messageId, messageText, reasoningText, toolCalls) => {
      if (!isMessageStreamingEnabledForSession(sessionId)) {
        return;
      }

      syncSessionRoutingContext(sessionId);
      const botApi = getSessionRoutingApi(sessionId);
      const target = getSessionRoutingTarget(sessionId);
      if (!botApi || !target) {
        return;
      }

      const mode = await getReasoningModeForSession(sessionId);
      if (!messageText.trim() && !reasoningText?.trim() && !toolCalls?.length) {
        return;
      }

      if (
        mode > 0 &&
        reasoningText?.trim() &&
        !(await getHideThinkingMessagesForSession(sessionId))
      ) {
        try {
          await streamThinkingBlocks({
            sessionId,
            logicalMessageId: messageId,
            sendApi: botApi,
            target,
            title: t("bot.thinking"),
            reasoningText,
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
        messageDraftStreamManager.enqueue(sessionId, botApi, target, messageText, assistantFormat);
      }

      void enqueueLocalFileFollowUpsFromText(
        sessionId,
        buildFollowUpCandidateText(messageText, reasoningText),
      );
    },
  );

  summaryAggregator.setOnComplete(
    async (sessionId, messageId, messageText, reasoningText, toolCalls, completionInfo) => {
      await enqueueSessionCompletionTask(sessionId, async () => {
        assistantRunState.markResponseCompleted(sessionId, completionInfo);

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
        const hasVisibleFinalContent = Boolean(
          messageText.trim() || reasoningText?.trim() || toolCalls?.length,
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

        if (mode > 0) {
          const thinkingFinalizeOutcome = await finalizeThinkingBlockStream({
            sessionId,
            logicalMessageId: completionInfo?.logicalMessageId ?? messageId,
            sendApi: botApi,
            target,
            title: t("bot.thinking"),
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

        const formattedTechnicals = (toolCalls || []).map((t) => ({
          description: t.title || t.tool,
          command:
            t.input &&
            typeof t.input === "object" &&
            "command" in t.input &&
            typeof t.input.command === "string"
              ? t.input.command
              : undefined,
        }));

        const finalFormat = getAssistantParseMode() === "MarkdownV2" ? "markdown_v2" : "raw";
        let finalText = messageText;
        let finalParseMode: "html" | "raw" | "markdown_v2" = finalFormat;

        if (mode > 0) {
          const assistantText =
            (finalFormat as string) === "html" ? messageText : markdownToHtml(messageText);

          const technicalsOnly = formattedTechnicals.map((t) => ({
            description: t.description,
            command: t.command,
          }));
          const chunks = formatReasoningForTelegramHtml(mode, "", technicalsOnly, assistantText);
          finalText = chunks[0] || assistantText;
          finalParseMode = "html";
        }

        try {
          const finalizeAssistantDelivery = finalAssistantDeliveryOrchestrator.enqueue({
            sessionId,
            channel: "durable",
            eventTimeMs: completionEventTimeMs,
            logicalMessageId: completionLogicalMessageId,
            deliver: async () => {
              await finalizeAssistantResponse({
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
                }),
              });
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
        } catch (err) {
          finalAssistantDeliveryOrchestrator.clearSession(sessionId);
          localFileFollowUpTracker.clearSession(sessionId);
          clearPromptResponseMode(sessionId);
          messageDraftStreamManager.clearSession(sessionId);
          assistantRunState.clearRun(sessionId, "assistant_finalize_failed");
          logger.error("Failed to send message to Telegram:", err);
          logger.error("[Bot] CRITICAL: Stopping event processing due to error");
          summaryAggregator.clear();
        }
      });
    },
  );

  summaryAggregator.setOnSessionIdle(async (sessionId) => {
    logger.debug("[Bot] setOnSessionIdle called", { sessionId });
    const pendingCompletionTask = sessionCompletionTasks.get(sessionId);
    if (pendingCompletionTask) {
      // 2026-04-19: message.updated(completed) schedules final delivery work through
      // the per-session completion queue. session.idle can arrive in the same tick,
      // so wait for that queued finalization before clearing routing/prompt state.
      await pendingCompletionTask.catch(() => undefined);
    }

    const completedRun = assistantRunState.finishRun(sessionId, "session_idle");
    clearPromptResponseMode(sessionId);

    syncSessionRoutingContext(sessionId);

    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || !hasLiveSessionTarget(sessionId)) {
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
      return;
    }

    try {
      await Promise.all([
        toolMessageBatcher.flushSession(sessionId, "session_idle"),
        toolCallStreamer.flushSession(sessionId, "session_idle"),
      ]);

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
              const keyboard = await getReplyKeyboardForSession(sessionId);
              await botApi.sendMessage(
                target.chatId,
                formatAssistantRunFooter({
                  agent,
                  providerID,
                  modelID,
                  elapsedMs: (completedRun.completedAt ?? Date.now()) - completedRun.startedAt,
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
      finalAssistantDeliveryOrchestrator.clearSession(sessionId);
      await clearThinkingBlockStream(sessionId, false);
      clearSessionRoutingContext(sessionId);
      localFileFollowUpTracker.clearSession(sessionId);
      messageDraftStreamManager.clearSession(sessionId);
      foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
      await scheduledTaskRuntime.flushDeferredDeliveries();
    }
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
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
        shouldIncludeToolInfoInFileCaption ||
        toolInfo.tool === "task"
      ) {
        orderedPublication.resolve(null);
        return;
      }

      const message = formatToolInfo(toolInfo);
      if (message) {
        if (!isSessionCurrent(toolInfo.sessionId)) {
          orderedPublication.resolve(null);
          toolCallStreamer.clearSession(toolInfo.sessionId, "tool_lost_live_routing_before_queue");
          return;
        }

        const spoilerMessage = formatToolCallAsSpoiler(message);
        orderedPublication.resolve(async () => {
          toolCallStreamer.replaceByPrefix(
            toolInfo.sessionId,
            `tool:${toolInfo.callId}`,
            spoilerMessage,
          );
          await enqueueLocalFileFollowUpsFromText(toolInfo.sessionId, spoilerMessage);
        });
        return;
      }

      orderedPublication.resolve(null);
    } catch (err) {
      orderedPublication.resolve(null);
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

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
      if (await getHideToolCallMessagesForSession(sessionId)) {
        orderedPublication.resolve(null);
        return;
      }

      const renderedCards = await renderSubagentCards(subagents);
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

      const toolMessage = formatToolInfo(fileInfo);
      const caption = prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

      toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
        ...fileInfo.fileData,
        caption,
      });
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    }
  });

  summaryAggregator.setOnQuestion(async (sessionId, questions, requestID) => {
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
    questionManager.startQuestions(questions, requestID, scopeKey, sessionId);
    await runWithSessionRoutingScope(sessionId, () =>
      showCurrentQuestion(botApi, target.chatId, target.messageThreadId),
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
    syncSessionRoutingContext(request.sessionID);
    const botApi = getSessionRoutingApi(request.sessionID);
    const target = getSessionRoutingTarget(request.sessionID);
    if (!botApi || !target) {
      logger.error("Bot or chat ID not available for showing permission request");
      return;
    }

    await Promise.all([
      toolMessageBatcher.flushSession(request.sessionID, "permission_asked"),
      toolCallStreamer.flushSession(request.sessionID, "permission_asked"),
    ]);

    logger.info(
      `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}`,
    );
    await runWithSessionRoutingScope(request.sessionID, () =>
      showPermissionRequest(botApi, target.chatId, request, target.messageThreadId),
    );
  });

  summaryAggregator.setOnThinking(async (sessionId) => {
    syncSessionRoutingContext(sessionId);
    if (!getSessionRoutingApi(sessionId) || !getSessionRoutingTarget(sessionId)) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    await toolCallStreamer.breakSession(sessionId, "thinking_started");

    const reasoningMode = await getReasoningModeForSession(sessionId);
    const hideThinkingMessages = await getHideThinkingMessagesForSession(sessionId);
    if (!hideThinkingMessages && reasoningMode === 0) {
      deliverThinkingMessage(sessionId, toolMessageBatcher, {
        hideThinkingMessages,
      });
    }

    if (pinnedMessageManager.isInitialized()) {
      await pinnedMessageManager.refresh();
    }
  });

  summaryAggregator.setOnTokens(async (tokens, isCompleted) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.debug(
        `[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}, completed=${isCompleted}`,
      );

      const contextSize = tokens.input + tokens.cacheRead;
      const contextLimit = pinnedMessageManager.getContextLimit();

      // Skip non-completed messages with zero context: a new assistant message
      // starts with tokens={input:0, ...} which would overwrite valid context
      // from the previous step. Only accept zeros from completed messages.
      if (!isCompleted && contextSize === 0) {
        logger.debug("[Bot] Skipping zero-token intermediate update");
        return;
      }

      // Update both keyboard and pinned state in memory (keeps them in sync)
      if (contextLimit > 0) {
        keyboardManager.updateContext(contextSize, contextLimit);
      }
      pinnedMessageManager.updateTokensSilent(tokens);

      // Full pinned message update (API call) only on completed messages
      if (isCompleted) {
        await pinnedMessageManager.onMessageComplete(tokens);
      }
    } catch (err) {
      logger.error("[Bot] Error updating pinned message with tokens:", err);
    }
  });

  summaryAggregator.setOnCost(async (cost) => {
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
    syncSessionRoutingContext(sessionId);
    const routing = getPromptRoutingContext(sessionId) ?? getSessionRoutingContext(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    const hasLiveTarget = hasLiveSessionTarget(sessionId);
    const shouldClearThinkingBlock = await runWithSessionRoutingScope(sessionId, async () =>
      getThinkingClearMode(),
    );
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

    clearSessionRoutingContext(sessionId);
    localFileFollowUpTracker.clearSession(sessionId);
    foregroundSessionState.markIdle(sessionId, getBusyScopeForSession(sessionId));
    await scheduledTaskRuntime.flushDeferredDeliveries();
  });

  summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
    syncSessionRoutingContext(sessionId);
    if (!getPromptRoutingContext(sessionId) && !getSessionRoutingContext(sessionId)) {
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

  summaryAggregator.setOnSessionDiff(async (_sessionId, diffs) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      await pinnedMessageManager.onSessionDiff(diffs);
    } catch (err) {
      logger.error("[Bot] Error updating session diff:", err);
    }
  });

  summaryAggregator.setOnFileChange((change) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }
    pinnedMessageManager.addFileChange(change);
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

  logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
  subscribeToEvents(directory, (event) => {
    if (event.type === "session.created" || event.type === "session.updated") {
      const info = (
        event.properties as { info?: { directory?: string; time?: { updated?: number } } }
      ).info;

      if (info?.directory) {
        safeBackgroundTask({
          taskName: `session.cache.${event.type}`,
          task: () => ingestSessionInfoForCache(info),
        });
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

    summaryAggregator.processEvent(event);
  }).catch((err) => {
    logger.error("Failed to subscribe to events:", err);
  });
}

export function createBot(): Bot<Context> {
  clearAllInteractionState("bot_startup");
  setUserLocaleResolver(getUserLocale);

  const botOptions: ConstructorParameters<typeof Bot<Context>>[1] = {};

  if (config.telegram.proxyUrl) {
    const proxyUrl = config.telegram.proxyUrl;
    let agent;

    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl);
      logger.info(`[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    } else {
      agent = new HttpsProxyAgent(proxyUrl);
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    }

    botOptions.client = {
      baseFetchConfig: {
        agent,
        compress: true,
      },
    };
  }

  const bot = new Bot(config.telegram.token, botOptions);
  activeBotInstance = bot;

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  setInterval(() => {
    heartbeatCounter++;
    if (heartbeatCounter % 6 === 0) {
      // Log every 30 seconds (5 sec * 6)
      logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
    }
  }, 5000);

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
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
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
      return next();
    });
  });
  bot.use(interactionGuardMiddleware);

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
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", opencodeStopCommand);
  bot.command("projects", projectsCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("model", modelCommand);
  bot.command("variant", variantCommand);
  bot.command("settings", settingsCommand);
  bot.command("new", newCommand);
  bot.command("abort", abortCommand);
  bot.command("task", taskCommand);
  bot.command("tasklist", taskListCommand);
  bot.command("rename", renameCommand);
  bot.command("commands", commandsCommand);
  bot.command("worktree", worktreeCommand);
  bot.command("open", openCommand);
  bot.command("skills", skillsCommand);
  bot.command("mcps", mcpsCommand);

  bot.on("message:text", unknownCommandMiddleware);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    try {
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      if (handledInlineCancel) {
        clearOpenPathIndex();
      }
      const handledSession = await handleSessionSelect(ctx);
      const handledProject = await handleProjectSelect(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledAccessApproval = await handleAccessApprovalCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledTask = await handleTaskCallback(ctx);
      const handledTaskList = await handleTaskListCallback(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);
      const handledCommands = await handleCommandsCallback(ctx, { bot, ensureEventSubscription });
      const handledSettings = await handleSettingsCallback(ctx);
      const handledWorktree = await handleWorktreeCallback(ctx);
      const handledOpen = await handleOpenCallback(ctx);
      const handledSkills = await handleSkillsCallback(ctx, { bot, ensureEventSubscription });
      const handledMcps = await handleMcpsCallback(ctx);

      logger.debug(
        `[Bot] Callback handled: inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, question=${handledQuestion}, accessApproval=${handledAccessApproval}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, task=${handledTask}, taskList=${handledTaskList}, rename=${handledRenameCancel}, commands=${handledCommands}, settings=${handledSettings}, worktree=${handledWorktree}, open=${handledOpen}, skills=${handledSkills}, mcps=${handledMcps}`,
      );

      if (
        !handledInlineCancel &&
        !handledSession &&
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
        !handledSkills &&
        !handledMcps
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

      await showAgentSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  // Handle Reply Keyboard button press (model selector)
  // Model button text is produced by formatModelForButton() and always starts with "🤖 ".
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

  // Handle Reply Keyboard button press (context button)
  bot.hears(/^📊(?:\s|$)/, async (ctx) => {
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await handleContextButtonPress(ctx);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  // Handle Reply Keyboard button press (variant selector)
  // Keep support for both legacy "💭" and current "💡" prefix.
  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Variant button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showVariantSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing variant menu:", err);
      await ctx.reply(t("error.load_variants"));
    }
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

    const promptDeps = { bot, ensureEventSubscription, deferredBatch };
    const handledCommandArgs = await handleCommandTextArguments(ctx, promptDeps);
    if (handledCommandArgs) {
      return;
    }

    const handledSkillArgs = await handleSkillTextArguments(ctx, promptDeps);
    if (handledSkillArgs) {
      return;
    }

    await processUserPrompt(ctx, text, promptDeps);

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
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
