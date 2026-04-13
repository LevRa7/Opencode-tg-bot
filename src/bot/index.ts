import { Bot, Context, InputFile, NextFunction } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config.js";
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
import {
  formatSummary,
  formatSummaryWithMode,
  formatToolInfo,
  getAssistantParseMode,
} from "../summary/formatter.js";
import { renderSubagentCards } from "../summary/subagent-formatter.js";
import { ToolMessageBatcher } from "../summary/tool-message-batcher.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { withTelegramRateLimitRetry } from "../utils/telegram-rate-limit-retry.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { t } from "../i18n/index.js";
import {
  clearPromptResponseMode,
  clearPromptRouting,
  getPromptRoutingContext,
  processUserPrompt,
} from "./handlers/prompt.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleDocumentMessage } from "./handlers/document.js";
import { handleVideoMessage } from "./handlers/video.js";
import { downloadTelegramFile, toDataUri } from "./utils/file-download.js";
import { finalizeAssistantResponse } from "./utils/finalize-assistant-response.js";
import { sendTtsResponseForSession } from "./utils/send-tts-response.js";
import { MessageDraftStreamManager } from "./utils/message-draft-stream.js";
import { ThinkingMessageLifecycleManager } from "./utils/thinking-message-lifecycle.js";
import { deliverThinkingMessage } from "./utils/thinking-message.js";
import { editBotText, sendBotText } from "./utils/telegram-text.js";
import {
  buildLocalFileFollowUpCaption,
  createLocalFileFollowUpTracker,
  extractLocalFilePaths,
  prepareLocalFileFollowUpsFromPaths,
  type PreparedLocalFileFollowUp,
} from "./utils/telegram-local-file-follow-up.js";
import { createPendingAssistantResponseStore } from "./utils/pending-assistant-response.js";
import { getModelCapabilities, supportsInput } from "../model/capabilities.js";
import { getStoredModel } from "../model/manager.js";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { ResponseStreamer } from "./streaming/response-streamer.js";
import { ToolCallStreamer } from "./streaming/tool-call-streamer.js";
import {
  editMessageWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./utils/send-with-markdown-fallback.js";
import { threadContextManager } from "../thread/manager.js";
import { withMessageThreadId } from "./utils/message-thread.js";
import {
  getReasoningMode,
  getTenantRuntimeInfo,
  getThinkingClearMode,
  isMessageStreamingEnabled,
} from "../settings/manager.js";
import {
  escapeHtml,
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

let activeBotInstance: Bot<Context> | null = null;

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;
const RESPONSE_STREAM_THROTTLE_MS = config.bot.responseStreamThrottleMs;
const SESSION_RETRY_PREFIX = "🔁";
const SUBAGENT_STREAM_PREFIX = "🧩";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", ".tmp");

interface SessionRoutingContext {
  bot: Bot<Context>;
  target: {
    chatId: number;
    messageThreadId?: number;
  };
  scope: TelegramConversationScope | null;
}

const routingBySessionId = new Map<string, SessionRoutingContext>();

function setSessionRoutingContext(sessionId: string, routing: SessionRoutingContext): void {
  routingBySessionId.set(sessionId, routing);
}

function syncSessionRoutingContext(sessionId: string): SessionRoutingContext | null {
  const promptRouting = getPromptRoutingContext(sessionId);
  if (!promptRouting) {
    return routingBySessionId.get(sessionId) ?? null;
  }

  const routing: SessionRoutingContext = {
    bot: promptRouting.bot,
    target: getThreadTargetForSession(sessionId) ?? promptRouting.target,
    scope: promptRouting.scope,
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

function getThreadTargetForSession(sessionId?: string) {
  if (!sessionId) {
    return null;
  }

  return threadContextManager.getSessionTarget(sessionId);
}

function getMessageThreadIdForSession(sessionId?: string): number | undefined {
  return getThreadTargetForSession(sessionId)?.messageThreadId;
}

function getSessionRoutingTarget(sessionId: string) {
  return getSessionRoutingContext(sessionId)?.target ?? getThreadTargetForSession(sessionId);
}

function getSessionRoutingApi(sessionId: string) {
  const routing = getSessionRoutingContext(sessionId);
  if (routing) {
    return routing.bot.api;
  }

  return activeBotInstance?.api ?? null;
}

function getSessionRoutingScope(sessionId: string): TelegramConversationScope | null {
  return getSessionRoutingContext(sessionId)?.scope ?? threadContextManager.getSessionScope(sessionId);
}

function getSessionRoutingScopeKey(sessionId: string): string {
  return buildTelegramConversationScopeKey(getSessionRoutingScope(sessionId));
}

async function runWithSessionRoutingScope<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return await runWithTelegramConversationScope(getSessionRoutingScope(sessionId), fn);
}

function getReasoningModeForSession(sessionId: string) {
  return runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () => getReasoningMode());
}

function isMessageStreamingEnabledForSession(sessionId: string): boolean {
  return runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () =>
    isMessageStreamingEnabled(),
  );
}

function isSessionCurrent(sessionId: string): boolean {
  return getSessionRoutingApi(sessionId) !== null && getSessionRoutingTarget(sessionId) !== undefined;
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

function getSessionLocalFilePathResolver(sessionId: string): ((filePath: string) => string) | undefined {
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

  return (filePath: string): string => {
    if (filePath === "/state" || filePath.startsWith("/state/")) {
      const relativePath = path.posix.relative("/state", filePath);
      return relativePath === "" || relativePath === "."
        ? tenantStateRoot
        : path.join(tenantStateRoot, relativePath);
    }

    if (filePath === "/workspace" || filePath.startsWith("/workspace/")) {
      const relativePath = path.posix.relative("/workspace", filePath);
      return relativePath === "" || relativePath === "."
        ? tenantWorkspaceRoot
        : path.join(tenantWorkspaceRoot, relativePath);
    }

    return filePath;
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

  const reservedPaths = localFileFollowUpTracker.reserve(sessionId, extractLocalFilePaths(text));
  if (reservedPaths.length === 0) {
    return;
  }

  const resolveLocalFilePath = getSessionLocalFilePathResolver(sessionId);
  const preparedFollowUps = await prepareLocalFileFollowUpsFromPaths(
    reservedPaths,
    resolveLocalFilePath,
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
          const currentTarget = getSessionRoutingTarget(sessionId);
          const currentApi = getSessionRoutingApi(sessionId);
          if (!currentTarget || !currentApi || !isSessionCurrent(sessionId)) {
            break;
          }

          await sendPreparedLocalFileFollowUp(currentApi, currentTarget, followUp);
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

    const keyboard = getCurrentReplyKeyboard();

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

      const keyboard = getCurrentReplyKeyboard();

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
const pendingAssistantResponses = createPendingAssistantResponseStore();
const localFileFollowUpTracker = createLocalFileFollowUpTracker();

const responseStreamer = new ResponseStreamer({
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
  sendText: async (sessionId, text, format, options) => {
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for streamed send");
    }

    const parseMode = format === "markdown_v2" ? "MarkdownV2" : undefined;
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
    const botApi = getSessionRoutingApi(sessionId);
    const target = getSessionRoutingTarget(sessionId);
    if (!botApi || !target || target.chatId <= 0) {
      throw new Error("Bot context missing for streamed edit");
    }

    const parseMode = format === "markdown_v2" ? "MarkdownV2" : undefined;

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

const messageDraftStreamManager = new MessageDraftStreamManager(RESPONSE_STREAM_THROTTLE_MS);
const thinkingMessageLifecycle = new ThinkingMessageLifecycleManager();

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
  const isAllowedUser = config.telegram.allowedUserIds.includes(userId);

  if (!isAdmin && !isAllowedUser) {
    await next();
    return;
  }

  try {
    await syncAuthorizedChatCommands(ctx.api, ctx.chat.id, ctx.chat.type, isAdmin);
    logger.debug(`[Bot] Commands initialized for user (chat_id=${ctx.chat.id}, isAdmin=${isAdmin})`);
  } catch (err) {
    logger.error("[Bot] Failed to sync commands:", err);
  }

  await next();
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
    thinkingMessageLifecycle.clearAll();
    pendingAssistantResponses.clearAll();
    localFileFollowUpTracker.clearAll();
  });

  summaryAggregator.setOnPartial(
    async (sessionId, _messageId, messageText, reasoningText, toolCalls) => {
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

      const formattedTechnicals = (toolCalls || []).map((t) => ({
        description: t.title || t.tool,
        command:
          t.input && typeof t.input === "object" && "command" in t.input && typeof t.input.command === "string"
            ? t.input.command
            : undefined,
      }));

      const assistantFormat = getAssistantParseMode() === "MarkdownV2" ? "markdown_v2" : "raw";

      messageDraftStreamManager.setSendEditApi(sessionId, botApi, botApi);

      if (mode > 0) {
        const assistantText =
          (assistantFormat as string) === "html" ? messageText : markdownToHtml(messageText);
        const chunks = formatReasoningForTelegramHtml(
          mode,
          reasoningText || "",
          formattedTechnicals,
          assistantText,
        );
        for (const chunk of chunks) {
          messageDraftStreamManager.enqueue(sessionId, botApi, target, chunk, "html");
        }
      } else {
        messageDraftStreamManager.enqueue(
          sessionId,
          botApi,
          target,
          messageText,
          assistantFormat,
        );
      }

      void enqueueLocalFileFollowUpsFromText(
        sessionId,
        buildFollowUpCandidateText(messageText, reasoningText),
      );
    },
  );

  summaryAggregator.setOnComplete(
    async (sessionId, _messageId, messageText, reasoningText, toolCalls) => {
      if (!isSessionCurrent(sessionId)) {
        pendingAssistantResponses.clear(sessionId);
        localFileFollowUpTracker.clearSession(sessionId);
        clearPromptResponseMode(sessionId);
        clearSessionRoutingContext(sessionId);
        messageDraftStreamManager.clearSession(sessionId);
        toolCallStreamer.clearSession(sessionId, "session_mismatch");
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      pendingAssistantResponses.set(sessionId, {
        messageText,
        reasoningText,
        toolCalls,
      });
    },
  );

  summaryAggregator.setOnSessionIdle(async (sessionId) => {
      syncSessionRoutingContext(sessionId);
      const pendingResponse = pendingAssistantResponses.consume(sessionId);
      const botApi = getSessionRoutingApi(sessionId);
      const target = getSessionRoutingTarget(sessionId);
      if (!botApi || !target) {
        logger.error("Bot or chat ID not available for sending message");
        pendingAssistantResponses.clear(sessionId);
        localFileFollowUpTracker.clearSession(sessionId);
        clearPromptResponseMode(sessionId);
        clearSessionRoutingContext(sessionId);
        messageDraftStreamManager.clearSession(sessionId);
        toolCallStreamer.clearSession(sessionId, "bot_context_missing");
        foregroundSessionState.markIdle(sessionId);
        return;
      }

      if (!isSessionCurrent(sessionId)) {
        pendingAssistantResponses.clear(sessionId);
        localFileFollowUpTracker.clearSession(sessionId);
        clearPromptResponseMode(sessionId);
        clearSessionRoutingContext(sessionId);
        messageDraftStreamManager.clearSession(sessionId);
        toolCallStreamer.clearSession(sessionId, "session_mismatch");
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      if (!pendingResponse) {
        clearPromptResponseMode(sessionId);
        localFileFollowUpTracker.clearSession(sessionId);
        clearSessionRoutingContext(sessionId);
        messageDraftStreamManager.clearSession(sessionId);
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      const chatId = target.chatId;
      const mode = await getReasoningModeForSession(sessionId);
      const formattedTechnicals = (pendingResponse.toolCalls || []).map((t) => ({
        description: t.title || t.tool,
        command:
          t.input && typeof t.input === "object" && "command" in t.input && typeof t.input.command === "string"
            ? t.input.command
            : undefined,
      }));

      const finalFormat = getAssistantParseMode() === "MarkdownV2" ? "markdown_v2" : "raw";
      let finalText = pendingResponse.messageText;
      let finalParseMode: "html" | "raw" | "markdown_v2" = finalFormat;
      let finalChunks: string[] | undefined;

      if (mode > 0) {
        const assistantText =
          (finalFormat as string) === "html"
            ? pendingResponse.messageText
            : markdownToHtml(pendingResponse.messageText);
        const chunks = formatReasoningForTelegramHtml(
          mode,
          pendingResponse.reasoningText || "",
          formattedTechnicals,
          assistantText,
        );
        finalText = chunks[0] || assistantText;
        finalChunks = chunks.length > 1 ? chunks : undefined;
        finalParseMode = "html";
      }

      try {
        const finalizeResult = await finalizeAssistantResponse({
          sessionId,
          messageText: finalText,
          sourceText: pendingResponse.messageText,
          chunks: finalChunks,
          flushDraftStream: (draftSessionId) =>
            messageDraftStreamManager.flushSession(draftSessionId),
          flushPendingServiceMessages: () =>
            Promise.all([
              toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
              toolCallStreamer.flushSession(sessionId, "assistant_message_completed"),
            ]).then(() => undefined),
          formatSummary,
          formatRawSummary: (text) => formatSummaryWithMode(text, "raw"),
          resolveFormat: () => finalParseMode,
          getReplyKeyboard: getCurrentReplyKeyboard,
          prepareLocalFileFollowUps: () =>
            prepareLocalFileFollowUpsFromPaths(
              extractLocalFilePaths(
                buildFollowUpCandidateText(
                  pendingResponse.messageText,
                  pendingResponse.reasoningText,
                ),
              ),
              getSessionLocalFilePathResolver(sessionId),
            ),
          sendText: async (text, rawFallbackText, options, format) => {
            const draftMessageId = messageDraftStreamManager.consumeLastSentMessageId(sessionId);
            if (draftMessageId) {
              await editBotText({
                api: botApi,
                chatId,
                messageId: draftMessageId,
                text: rawFallbackText ?? text,
                rawFallbackText: text,
                options: undefined,
                format,
              });
            } else {
              await sendBotText({
                api: botApi,
                chatId,
                text,
                rawFallbackText,
                options: options as Parameters<typeof sendBotText>[0]["options"],
                format,
                messageThreadId: getMessageThreadIdForSession(sessionId),
              });
            }
          },
        });

        if (finalizeResult.followUpFiles.length > 0) {
          const reservedPaths = localFileFollowUpTracker.reserve(
            sessionId,
            finalizeResult.followUpFiles.map((followUp) => followUp.path),
          );
          const reservedPathSet = new Set(reservedPaths);
          const reservedFollowUps = finalizeResult.followUpFiles.filter((followUp) =>
            reservedPathSet.has(followUp.path),
          );

          if (reservedFollowUps.length > 0) {
            safeBackgroundTask({
              taskName: `telegram.local-file-follow-up.${sessionId}`,
              task: async () => {
                const sentPaths: string[] = [];
                try {
                  for (const followUp of reservedFollowUps) {
                    const currentTarget = getSessionRoutingTarget(sessionId);
                    const currentApi = getSessionRoutingApi(sessionId);
                    if (!currentTarget || !currentApi || !isSessionCurrent(sessionId)) {
                      break;
                    }

                    await sendPreparedLocalFileFollowUp(currentApi, currentTarget, followUp);
                    sentPaths.push(followUp.path);
                  }
                } finally {
                  if (sentPaths.length > 0) {
                    localFileFollowUpTracker.markSent(sessionId, sentPaths);
                  }

                  const unsentPaths = reservedFollowUps
                    .map((followUp) => followUp.path)
                    .filter((filePath) => !sentPaths.includes(filePath));
                  if (unsentPaths.length > 0) {
                    localFileFollowUpTracker.release(sessionId, unsentPaths);
                  }
                }
              },
            });
          }
        }

        await sendTtsResponseForSession({
          api: botApi,
          sessionId,
          chatId,
          text: pendingResponse.messageText,
          messageThreadId: getMessageThreadIdForSession(sessionId),
        });
      } catch (err) {
        pendingAssistantResponses.clear(sessionId);
        localFileFollowUpTracker.clearSession(sessionId);
        clearPromptResponseMode(sessionId);
        messageDraftStreamManager.clearSession(sessionId);
        logger.error("Failed to send message to Telegram:", err);
        logger.error("[Bot] CRITICAL: Stopping event processing due to error");
        summaryAggregator.clear();
      } finally {
        const shouldClearThinking = await runWithSessionRoutingScope(sessionId, async () =>
          getThinkingClearMode(),
        );
        await thinkingMessageLifecycle.finalize(sessionId, shouldClearThinking, {
          sendText: async () => 0,
          editText: async () => undefined,
          deleteText: async (messageId) => {
            await botApi.deleteMessage(chatId, messageId).catch(() => {});
          },
        });
        clearSessionRoutingContext(sessionId);
        localFileFollowUpTracker.clearSession(sessionId);
        messageDraftStreamManager.clearSession(sessionId);
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
      }
    },
  );

  summaryAggregator.setOnTool(async (toolInfo) => {
    syncSessionRoutingContext(toolInfo.sessionId);
    if (!isSessionCurrent(toolInfo.sessionId)) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    const shouldIncludeToolInfoInFileCaption =
      toolInfo.hasFileAttachment &&
      (toolInfo.tool === "write" || toolInfo.tool === "edit" || toolInfo.tool === "apply_patch");

    if (
      config.bot.hideToolCallMessages ||
      shouldIncludeToolInfoInFileCaption ||
      toolInfo.tool === "task"
    ) {
      return;
    }

    try {
      const message = formatToolInfo(toolInfo);
      if (message) {
        const spoilerMessage = formatToolCallAsSpoiler(message);
        toolCallStreamer.replaceByPrefix(toolInfo.sessionId, `tool:${toolInfo.callId}`, spoilerMessage);
        void enqueueLocalFileFollowUpsFromText(toolInfo.sessionId, spoilerMessage);
      }
    } catch (err) {
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  summaryAggregator.setOnSubagent(async (sessionId, subagents) => {
    syncSessionRoutingContext(sessionId);
    if (!isSessionCurrent(sessionId)) {
      return;
    }

    if (config.bot.hideToolCallMessages) {
      return;
    }

    try {
      const renderedCards = await renderSubagentCards(subagents);
      if (!renderedCards) {
        return;
      }

      const spoilerCards = formatToolCallAsSpoiler(renderedCards);
      toolCallStreamer.replaceByPrefix(sessionId, SUBAGENT_STREAM_PREFIX, spoilerCards);
      void enqueueLocalFileFollowUpsFromText(sessionId, spoilerCards);
    } catch (err) {
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
    questionManager.startQuestions(questions, requestID, scopeKey);
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
    if (!getSessionRoutingContext(sessionId)) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    await toolCallStreamer.breakSession(sessionId, "thinking_started");

    deliverThinkingMessage(sessionId, toolMessageBatcher, {
      hideThinkingMessages: config.bot.hideThinkingMessages,
    });

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
    if (!routing || !target) {
      clearPromptResponseMode(sessionId);
      localFileFollowUpTracker.clearSession(sessionId);
      clearSessionRoutingContext(sessionId);
      messageDraftStreamManager.clearSession(sessionId);
      foregroundSessionState.markIdle(sessionId);
      return;
    }

    messageDraftStreamManager.clearSession(sessionId);
    localFileFollowUpTracker.clearSession(sessionId);
    const shouldClearThinking = await runWithSessionRoutingScope(sessionId, async () =>
      getThinkingClearMode(),
    );
    await thinkingMessageLifecycle.finalize(sessionId, shouldClearThinking, {
      sendText: async () => 0,
      editText: async () => undefined,
      deleteText: async (messageId) => {
        await routing.bot.api.deleteMessage(target.chatId, messageId).catch(() => {});
      },
    });
    clearPromptResponseMode(sessionId);
    await Promise.all([
      toolMessageBatcher.flushSession(sessionId, "session_error"),
      toolCallStreamer.flushSession(sessionId, "session_error"),
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
    foregroundSessionState.markIdle(sessionId);
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

    summaryAggregator.processEvent(event);
  }).catch((err) => {
    logger.error("Failed to subscribe to events:", err);
  });
}

export function createBot(): Bot<Context> {
  clearAllInteractionState("bot_startup");

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
  bot.command("new", newCommand);
  bot.command("abort", abortCommand);
  bot.command("task", taskCommand);
  bot.command("tasklist", taskListCommand);
  bot.command("rename", renameCommand);
  bot.command("commands", commandsCommand);

  bot.on("message:text", unknownCommandMiddleware);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);


    try {
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
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

      logger.debug(
        `[Bot] Callback handled: inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, question=${handledQuestion}, accessApproval=${handledAccessApproval}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, task=${handledTask}, taskList=${handledTaskList}, rename=${handledRenameCancel}, commands=${handledCommands}`,
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
        !handledCommands
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

  // Voice and audio message handlers (STT transcription -> prompt)
  const voicePromptDeps = { bot, ensureEventSubscription };

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  // Photo message handler
  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);

    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      return;
    }

    const caption = ctx.message.caption || "";

    try {
      // Get the largest photo (last element in array)
      const largestPhoto = photos[photos.length - 1];

      // Check model capabilities
      const storedModel = getStoredModel();
      const capabilities = await getModelCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "image")) {
        logger.warn(
          `[Bot] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input`,
        );
        await ctx.reply(t("bot.photo_model_no_image"));

        // Fall back to caption-only if present
        if (caption.trim().length > 0) {
          const promptDeps = { bot, ensureEventSubscription };
          await processUserPrompt(ctx, caption, promptDeps);
        }
        return;
      }

      // Download photo
      await ctx.reply(t("bot.photo_downloading"));
      const downloadedFile = await downloadTelegramFile(ctx.api, largestPhoto.file_id);

      // Convert to data URI (Telegram always converts photos to JPEG)
      const dataUri = toDataUri(downloadedFile.buffer, "image/jpeg");

      // Create file part
      const filePart: FilePartInput = {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: dataUri,
      };

      logger.info(`[Bot] Sending photo (${downloadedFile.buffer.length} bytes) with prompt`);

      // Send via processUserPrompt with file part
      const promptDeps = { bot, ensureEventSubscription };
      await processUserPrompt(ctx, caption, promptDeps, [filePart]);
    } catch (err) {
      logger.error("[Bot] Error handling photo message:", err);
      await ctx.reply(t("bot.photo_download_error"));
    }
  });

  // Document message handler (PDF and text files)
  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);
    const deps = { bot, ensureEventSubscription };
    await handleDocumentMessage(ctx, deps);
  });

  bot.on(["message:video", "message:video_note"], async (ctx) => {
    logger.debug(`[Bot] Received video message, chatId=${ctx.chat.id}`);
    const deps = { bot, ensureEventSubscription };
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

    const promptDeps = { bot, ensureEventSubscription };
    const handledCommandArgs = await handleCommandTextArguments(ctx, promptDeps);
    if (handledCommandArgs) {
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
