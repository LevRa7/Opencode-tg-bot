import type { Api, RawApi } from "grammy";
import { SessionDeliveryOrchestrator } from "../delivery/session-delivery-orchestrator.js";
import { createSafeTelegramSender } from "../delivery/safe-telegram-sender.js";
import { logger } from "../../utils/logger.js";
import type { MessageDraftIdAllocator } from "./message-draft-id.js";
import { withMessageThreadId, type TelegramThreadTarget } from "./message-thread.js";
import { sendMessageWithoutDraftEffect } from "./send-message-draft-effect-context.js";
import {
  ThinkingDraftLifecycle,
  type ThinkingDraftClearOutcome,
  type ThinkingDraftTransport,
} from "./thinking-draft-lifecycle.js";
import { NoopDetailsPublisher } from "../../telegraph/noop-details-publisher.js";
import type { TechnicalDetailsPublisher } from "../../telegraph/details-publisher.js";
import {
  formatThinkingCompletionMessage,
  formatThinkingCompletionWithDetails,
  formatThinkingMessageWithReasoning,
} from "./thinking-message.js";

type SendApi = Pick<Api<RawApi>, "sendMessageDraft" | "sendMessage" | "deleteMessage">;

interface LegacyThinkingCleanupTransport {
  sendText: (text: string) => Promise<number>;
  editText: (messageId: number, text: string) => Promise<void>;
  deleteText: (messageId: number) => Promise<void>;
  routingIdentity?: string;
}

interface ActiveThinkingBlockState {
  lastRenderedText: string;
  lastReasoningText: string;
  draftId: number;
  routingIdentity: string;
  sendApi: SendApi;
  target: TelegramThreadTarget;
  requiresReplay?: true;
}

interface SessionStreamTaskState {
  task: Promise<void>;
}

interface StreamThinkingBlocksOptions {
  sessionId: string;
  logicalMessageId?: string;
  sendApi: SendApi;
  target: TelegramThreadTarget;
  title: string;
  reasoningText: string;
}

interface FinalizeThinkingBlockStreamOptions {
  sessionId: string;
  logicalMessageId?: string;
  sendApi: SendApi;
  target: TelegramThreadTarget;
  title: string;
  reasoningText?: string;
  publisher?: TechnicalDetailsPublisher;
  locale?: string;
}

export type ThinkingBlockFinalizeOutcome = "finalized" | "failed" | "cleared";

type ThinkingBlockDeliveryOrchestrator = Pick<
  SessionDeliveryOrchestrator,
  "enqueue" | "flushSession" | "clearSession" | "clearAll"
>;

function createDeliveryOrchestrator(): ThinkingBlockDeliveryOrchestrator {
  return new SessionDeliveryOrchestrator({
    onError: async (error, item) => {
      logger.warn(
        `[ThinkingBlockStream] Delivery failed: session=${item.sessionId}, channel=${item.channel}`,
        error,
      );
    },
  });
}

const lifecycleManager = new ThinkingDraftLifecycle();
const fallbackDetailsPublisher = new NoopDetailsPublisher();
let deliveryOrchestrator: ThinkingBlockDeliveryOrchestrator = createDeliveryOrchestrator();
const activeThinkingBlocks = new Map<string, ActiveThinkingBlockState>();
const sessionTasks = new Map<string, SessionStreamTaskState>();

let thinkingBlockDraftIdAllocator: MessageDraftIdAllocator | null = null;

function buildRoutingIdentity(target: TelegramThreadTarget): string {
  return `${target.chatId}:${target.messageThreadId ?? "main"}`;
}

export function configureThinkingBlockDraftIdAllocator(allocator: MessageDraftIdAllocator): void {
  thinkingBlockDraftIdAllocator = allocator;
}

export function configureThinkingBlockDeliveryOrchestratorForTests(
  orchestrator: ThinkingBlockDeliveryOrchestrator | null,
): void {
  deliveryOrchestrator = orchestrator ?? createDeliveryOrchestrator();
}

function reserveThinkingDraftId(): number {
  return thinkingBlockDraftIdAllocator?.next() ?? 0;
}

function shouldDropCoordinatorState(outcome: ThinkingDraftClearOutcome): boolean {
  return outcome === "cleared" || outcome === "dropped";
}

function createTransport(
  sendApi: SendApi,
  target: TelegramThreadTarget,
  draftId: number,
  routingIdentity = buildRoutingIdentity(target),
): ThinkingDraftTransport {
  const safeSender = createSafeTelegramSender(sendApi as Parameters<typeof createSafeTelegramSender>[0]);

  return {
    chatId: target.chatId,
    messageThreadId: target.messageThreadId,
    draftId,
    routingIdentity,
    sendMessageDraft: async (chatId: number, nextDraftId: number, text: string, options) => {
      await safeSender.sendMessageDraft(chatId, nextDraftId, text, options);
    },
    sendMessage: async (chatId: number, text: string, options) => {
      return sendMessageWithoutDraftEffect(
        {
          sendMessage: safeSender.sendMessage,
        },
        chatId,
        text,
        withMessageThreadId(options, target.messageThreadId),
      );
    },
    deleteMessage: async (chatId: number, messageId: number) => {
      await safeSender.deleteMessage(chatId, messageId).catch(() => undefined);
    },
  };
}

function resolveThinkingLogicalMessageId(sessionId: string, logicalMessageId?: string): string {
  return logicalMessageId?.trim() || `thinking:${sessionId}`;
}

function createCleanupTransport(
  sessionId: string,
  transport?: LegacyThinkingCleanupTransport,
): ThinkingDraftTransport | null {
  const activeState = activeThinkingBlocks.get(sessionId);
  if (activeState) {
    if (transport) {
      return {
        chatId: activeState.target.chatId,
        messageThreadId: activeState.target.messageThreadId,
        draftId: activeState.draftId,
        // 2026-04-23: missing-routing cleanup can arrive from a different route after
        // routing state is gone, but the visible draft still belongs to the stored route.
        // Keep the active route identity so lifecycle deletion targets that old draft.
        routingIdentity: activeState.routingIdentity,
        sendMessageDraft: async () => undefined,
        sendMessage: async (chatId: number, text: string) =>
          sendMessageWithoutDraftEffect(
            activeState.sendApi,
            chatId,
            text,
            withMessageThreadId(
              {
                parse_mode: "HTML" as const,
                disable_notification: true,
              },
              activeState.target.messageThreadId,
            ),
          ),
        deleteMessage: async (_chatId: number, messageId: number) => {
          // 2026-04-23: cross-route error cleanup must delete the visible draft from the
          // stored active route, not from the caller's current route-scoped closure.
          await activeState.sendApi
            .deleteMessage(activeState.target.chatId, messageId)
            .catch(() => undefined);
        },
      };
    }

    return createTransport(
      activeState.sendApi,
      activeState.target,
      activeState.draftId,
      activeState.routingIdentity,
    );
  }

  if (!transport) {
    return null;
  }

  return {
    chatId: 0,
    messageThreadId: undefined,
    draftId: 0,
    routingIdentity: transport.routingIdentity ?? "unknown:main",
    sendMessageDraft: async () => undefined,
    sendMessage: async () => ({ message_id: 0 }),
    deleteMessage: async (_chatId: number, messageId: number) => {
      await transport.deleteText(messageId);
    },
  };
}

async function runSessionTask<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const state = sessionTasks.get(sessionId) ?? { task: Promise.resolve() };
  const resultPromise = state.task.catch(() => undefined).then(task);
  const nextTask: Promise<void> = resultPromise
    .then(() => undefined, () => undefined)
    .finally(() => {
      if (sessionTasks.get(sessionId)?.task === nextTask) {
        sessionTasks.delete(sessionId);
      }
    });

  state.task = nextTask;
  sessionTasks.set(sessionId, state);
  return await resultPromise;
}

export async function streamThinkingBlocks(options: StreamThinkingBlocksOptions): Promise<void> {
  if (!options.sessionId || !options.reasoningText.trim()) {
    return;
  }

  await runSessionTask(options.sessionId, async () => {
    const rendered = formatThinkingMessageWithReasoning(options.title, options.reasoningText);
    const routingIdentity = buildRoutingIdentity(options.target);
    const existing = activeThinkingBlocks.get(options.sessionId);
    if (
      existing?.lastRenderedText === rendered.text &&
      existing.routingIdentity === routingIdentity &&
      !existing.requiresReplay
    ) {
      activeThinkingBlocks.set(options.sessionId, {
        ...existing,
        lastReasoningText: options.reasoningText,
      });
      return;
    }

    const previousState = existing;
    if (previousState && previousState.routingIdentity !== routingIdentity) {
      // Route changes must clear the old draft first so stale reasoning is not left visible.
      await lifecycleManager.clearActiveDraft(
        options.sessionId,
        true,
        createTransport(
          previousState.sendApi,
          previousState.target,
          previousState.draftId,
          previousState.routingIdentity,
        ),
      );
    }

    // 2026-05-09: Telegram treats sendMessageDraft's id as a one-shot random_id;
    // reusing it for later draft updates causes RANDOM_ID_INVALID in live chats.
    const draftId = reserveThinkingDraftId();
    const transport = createTransport(options.sendApi, options.target, draftId, routingIdentity);

    activeThinkingBlocks.set(options.sessionId, {
      lastRenderedText: rendered.text,
      lastReasoningText: options.reasoningText,
      draftId,
      routingIdentity,
      sendApi: options.sendApi,
      target: options.target,
    });

    try {
      await deliveryOrchestrator.enqueue({
        sessionId: options.sessionId,
        channel: "live",
        logicalMessageId: resolveThinkingLogicalMessageId(
          options.sessionId,
          options.logicalMessageId,
        ),
        deliver: async () => {
          await lifecycleManager.renderActiveDraft(options.sessionId, rendered.text, transport);
        },
      });
    } catch (error) {
      if (previousState) {
        activeThinkingBlocks.set(options.sessionId, {
          ...previousState,
          requiresReplay: true,
        });
      } else {
        activeThinkingBlocks.delete(options.sessionId);
      }
      throw error;
    }
  });
}

export async function finalizeThinkingBlockStream(
  options: FinalizeThinkingBlockStreamOptions,
): Promise<ThinkingBlockFinalizeOutcome> {
  return await runSessionTask(options.sessionId, async () => {
    const activeState = activeThinkingBlocks.get(options.sessionId);
    const currentRoutingIdentity = buildRoutingIdentity(options.target);
    if (activeState && activeState.routingIdentity !== currentRoutingIdentity) {
      // 2026-04-23: finalize can race behind a route switch; clear the stale draft
      // through its original transport so nothing is published into the old route.
      const clearOutcome = await lifecycleManager.clearActiveDraft(
        options.sessionId,
        true,
        createTransport(
          activeState.sendApi,
          activeState.target,
          activeState.draftId,
          activeState.routingIdentity,
        ),
      );
      if (shouldDropCoordinatorState(clearOutcome)) {
        activeThinkingBlocks.delete(options.sessionId);
      }
      return "cleared";
    }

    const sendApi = activeState?.sendApi ?? options.sendApi;
    const target = activeState?.target ?? options.target;
    const draftId = reserveThinkingDraftId();
    const routingIdentity = activeState?.routingIdentity ?? currentRoutingIdentity;
    const completionReasoningText = options.reasoningText?.trim() || activeState?.lastReasoningText || "";
    const completion = formatThinkingCompletionMessage(options.title, completionReasoningText);
    let completionText = completion.text;
    try {
      const linkedCompletion = await formatThinkingCompletionWithDetails(
        options.title,
        completionReasoningText,
        options.publisher ?? fallbackDetailsPublisher,
        options.locale,
      );
      completionText = linkedCompletion.text;
    } catch (error) {
      logger.warn(
        `[ThinkingBlockStream] Final thinking details publication failed: session=${options.sessionId}`,
        error,
      );
    }
    const transport = createTransport(sendApi, target, draftId, routingIdentity);
    const logicalMessageId = resolveThinkingLogicalMessageId(
      options.sessionId,
      options.logicalMessageId,
    );

    await deliveryOrchestrator.enqueue({
      sessionId: options.sessionId,
      channel: "live",
      logicalMessageId,
      isTerminal: true,
      deliver: async () => undefined,
    });

    try {
      const finalizeDelivery = deliveryOrchestrator.enqueue({
        sessionId: options.sessionId,
        channel: "durable",
        waitForLogicalMessageLiveTerminal: logicalMessageId,
        deliver: async () => {
          await lifecycleManager.renderActiveDraft(options.sessionId, completionText, transport);
          await lifecycleManager.finalizeDraft(options.sessionId, transport);
        },
      });

      await deliveryOrchestrator.flushSession(options.sessionId);
      await finalizeDelivery;
      activeThinkingBlocks.delete(options.sessionId);
      return "finalized";
    } catch (error) {
      logger.warn(
        `[ThinkingBlockStream] Final thinking delivery failed: session=${options.sessionId}`,
        error,
      );
      return "failed";
    }
  });
}

export async function clearThinkingBlockStream(
  sessionId: string,
  shouldClear = true,
  transport?: LegacyThinkingCleanupTransport,
): Promise<void> {
  await runSessionTask(sessionId, async () => {
    deliveryOrchestrator.clearSession(sessionId);
    const activeState = activeThinkingBlocks.get(sessionId);
    const cleanupTransport = createCleanupTransport(sessionId, transport);
    if (cleanupTransport) {
      const clearOutcome = await lifecycleManager.clearActiveDraft(
        sessionId,
        shouldClear,
        cleanupTransport,
      );
      if (activeState && shouldDropCoordinatorState(clearOutcome)) {
        activeThinkingBlocks.delete(sessionId);
      }
    } else {
      // 2026-04-23: once routing is gone there is no retryable delete path left,
      // so stale coordinator state must be dropped even if forced clear was requested.
      lifecycleManager.clearSession(sessionId);
      activeThinkingBlocks.delete(sessionId);
    }
  });
}

export function clearAllThinkingBlockStreams(): void {
  activeThinkingBlocks.clear();
  sessionTasks.clear();
  deliveryOrchestrator.clearAll();
  lifecycleManager.clearAll();
}
