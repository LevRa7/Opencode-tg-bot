import type { Api, RawApi } from "grammy";
import type { MessageDraftIdAllocator } from "./message-draft-id.js";
import { withMessageThreadId, type TelegramThreadTarget } from "./message-thread.js";
import { sendMessageWithoutDraftEffect } from "./send-message-draft-effect-context.js";
import {
  ThinkingDraftLifecycle,
  type ThinkingDraftClearOutcome,
  type ThinkingDraftTransport,
} from "./thinking-draft-lifecycle.js";
import { formatThinkingMessageWithReasoning } from "./thinking-message.js";

type SendApi = Pick<Api<RawApi>, "sendMessageDraft" | "sendMessage" | "deleteMessage">;

interface LegacyThinkingCleanupTransport {
  sendText: (text: string) => Promise<number>;
  editText: (messageId: number, text: string) => Promise<void>;
  deleteText: (messageId: number) => Promise<void>;
  routingIdentity?: string;
}

interface ActiveThinkingBlockState {
  lastRenderedText: string;
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
  sendApi: SendApi;
  target: TelegramThreadTarget;
  title: string;
  reasoningText: string;
}

interface FinalizeThinkingBlockStreamOptions {
  sessionId: string;
  sendApi: SendApi;
  target: TelegramThreadTarget;
  title: string;
}

const lifecycleManager = new ThinkingDraftLifecycle();
const activeThinkingBlocks = new Map<string, ActiveThinkingBlockState>();
const sessionTasks = new Map<string, SessionStreamTaskState>();

let thinkingBlockDraftIdAllocator: MessageDraftIdAllocator | null = null;

function buildRoutingIdentity(target: TelegramThreadTarget): string {
  return `${target.chatId}:${target.messageThreadId ?? "main"}`;
}

export function configureThinkingBlockDraftIdAllocator(allocator: MessageDraftIdAllocator): void {
  thinkingBlockDraftIdAllocator = allocator;
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
  return {
    chatId: target.chatId,
    messageThreadId: target.messageThreadId,
    draftId,
    routingIdentity,
    sendMessageDraft: async (chatId: number, nextDraftId: number, text: string, options) => {
      await sendApi.sendMessageDraft(chatId, nextDraftId, text, options);
    },
    sendMessage: async (chatId: number, text: string, options) => {
      return sendMessageWithoutDraftEffect(
        sendApi,
        chatId,
        text,
        withMessageThreadId(options, target.messageThreadId),
      );
    },
    deleteMessage: async (chatId: number, messageId: number) => {
      await sendApi.deleteMessage(chatId, messageId).catch(() => undefined);
    },
  };
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

async function runSessionTask(sessionId: string, task: () => Promise<void>): Promise<void> {
  const state = sessionTasks.get(sessionId) ?? { task: Promise.resolve() };
  const nextTask = state.task
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (sessionTasks.get(sessionId)?.task === nextTask) {
        sessionTasks.delete(sessionId);
      }
    });

  state.task = nextTask;
  sessionTasks.set(sessionId, state);
  await nextTask;
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

    const draftId =
      existing?.routingIdentity === routingIdentity ? existing.draftId : reserveThinkingDraftId();
    const transport = createTransport(options.sendApi, options.target, draftId, routingIdentity);

    activeThinkingBlocks.set(options.sessionId, {
      lastRenderedText: rendered.text,
      draftId,
      routingIdentity,
      sendApi: options.sendApi,
      target: options.target,
    });

    try {
      await lifecycleManager.renderActiveDraft(options.sessionId, rendered.text, transport);
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
): Promise<void> {
  await runSessionTask(options.sessionId, async () => {
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
      return;
    }

    const sendApi = activeState?.sendApi ?? options.sendApi;
    const target = activeState?.target ?? options.target;
    const draftId = activeState?.draftId ?? 0;
    const routingIdentity = activeState?.routingIdentity ?? currentRoutingIdentity;
    await lifecycleManager.finalizeDraft(
      options.sessionId,
      createTransport(sendApi, target, draftId, routingIdentity),
    );
    activeThinkingBlocks.delete(options.sessionId);
  });
}

export async function clearThinkingBlockStream(
  sessionId: string,
  shouldClear = true,
  transport?: LegacyThinkingCleanupTransport,
): Promise<void> {
  await runSessionTask(sessionId, async () => {
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
  lifecycleManager.clearAll();
}
