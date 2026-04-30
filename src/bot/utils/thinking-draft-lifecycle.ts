import { logger } from "../../utils/logger.js";
import { chunkTelegramHtml, getFirstTelegramHtmlChunk } from "./telegram-html-chunker.js";

interface ThinkingDraftTransportOptions {
  parse_mode: "HTML";
  message_thread_id?: number;
  disable_notification: true;
}

export interface ThinkingDraftTransport {
  chatId: number;
  messageThreadId?: number;
  draftId: number;
  routingIdentity: string;
  sendMessageDraft: (
    chatId: number,
    draftId: number,
    text: string,
    options: ThinkingDraftTransportOptions,
  ) => Promise<unknown>;
  sendMessage: (
    chatId: number,
    text: string,
    options: ThinkingDraftTransportOptions,
  ) => Promise<{ message_id: number }>;
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
}

export type ThinkingDraftClearOutcome = "cleared" | "dropped" | "preserved" | "missing";

interface ActiveDraftState {
  lastText: string;
  draftId: number;
  routingIdentity: string;
  transport: ThinkingDraftTransport;
  failedRenderError: Error | null;
  finalizedText: string | null;
  nextFinalizeChunkIndex: number;
  task: Promise<void>;
}

function buildOptions(messageThreadId?: number): ThinkingDraftTransportOptions {
  return {
    parse_mode: "HTML",
    ...(typeof messageThreadId === "number" ? { message_thread_id: messageThreadId } : {}),
    disable_notification: true,
  };
}

export class ThinkingDraftLifecycle {
  private readonly states = new Map<string, ActiveDraftState>();

  async renderActiveDraft(
    sessionId: string,
    text: string,
    transport: ThinkingDraftTransport,
  ): Promise<void> {
    if (!sessionId || !text.trim()) {
      return;
    }

    const state = this.getOrCreateState(sessionId, transport);
    state.task = state.task
      .catch(() => undefined)
      .then(async () => {
        if (
          state.lastText === text &&
          state.routingIdentity === transport.routingIdentity &&
          state.draftId === transport.draftId
        ) {
          state.failedRenderError = null;
          return;
        }

        await transport.sendMessageDraft(
          transport.chatId,
          transport.draftId,
          getFirstTelegramHtmlChunk(text),
          buildOptions(transport.messageThreadId),
        );

        state.lastText = text;
        state.draftId = transport.draftId;
        state.routingIdentity = transport.routingIdentity;
        state.transport = transport;
        state.failedRenderError = null;
        state.finalizedText = null;
        state.nextFinalizeChunkIndex = 0;
      })
      .catch((error) => {
        state.failedRenderError = error instanceof Error ? error : new Error(String(error));
        logger.error(
          `[ThinkingDraftLifecycle] Failed to render draft for session=${sessionId}`,
          error,
        );
        throw state.failedRenderError;
      });

    await state.task;
  }

  async finalizeDraft(sessionId: string, _transport: ThinkingDraftTransport): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    await state.task.catch(() => undefined);
    if (state.failedRenderError) {
      throw state.failedRenderError;
    }

    if (!state.lastText) {
      this.states.delete(sessionId);
      return;
    }

    const activeTransport = state.transport;
    if (state.finalizedText !== state.lastText) {
      state.finalizedText = state.lastText;
      state.nextFinalizeChunkIndex = 0;
    }

    const chunks = chunkTelegramHtml(state.lastText);
    for (let index = state.nextFinalizeChunkIndex; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      await activeTransport.sendMessage(
        activeTransport.chatId,
        chunk,
        buildOptions(activeTransport.messageThreadId),
      );
      state.nextFinalizeChunkIndex = index + 1;
    }
    this.states.delete(sessionId);
  }

  async clearActiveDraft(
    sessionId: string,
    shouldClear: boolean,
    transport: ThinkingDraftTransport,
  ): Promise<ThinkingDraftClearOutcome> {
    const state = this.states.get(sessionId);
    if (!state) {
      return "missing";
    }

    await state.task.catch(() => undefined);

    if (!shouldClear || state.routingIdentity !== transport.routingIdentity) {
      this.states.delete(sessionId);
      return "dropped";
    }

    if (shouldClear) {
      try {
        await transport.deleteMessage(transport.chatId, state.draftId);
      } catch (error) {
        logger.warn(
          `[ThinkingDraftLifecycle] Failed to clear draft for session=${sessionId}`,
          error,
        );
        return "preserved";
      }
    }

    this.states.delete(sessionId);
    return "cleared";
  }

  clearSession(sessionId: string): void {
    this.states.delete(sessionId);
  }

  clearAll(): void {
    this.states.clear();
  }

  private getOrCreateState(sessionId: string, transport: ThinkingDraftTransport): ActiveDraftState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: ActiveDraftState = {
      lastText: "",
      draftId: transport.draftId,
      routingIdentity: transport.routingIdentity,
      transport,
      failedRenderError: null,
      finalizedText: null,
      nextFinalizeChunkIndex: 0,
      task: Promise.resolve(),
    };
    this.states.set(sessionId, created);
    return created;
  }
}
