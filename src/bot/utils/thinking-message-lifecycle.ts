import { logger } from "../../utils/logger.js";

interface ThinkingMessageTransport {
  sendText: (text: string) => Promise<number>;
  editText: (messageId: number, text: string) => Promise<void>;
  deleteText: (messageId: number) => Promise<void>;
}

interface ThinkingMessageState {
  messageId?: number;
  lastText: string;
  task: Promise<void>;
}

export class ThinkingMessageLifecycleManager {
  private readonly states = new Map<string, ThinkingMessageState>();

  async render(
    sessionId: string,
    text: string,
    transport: ThinkingMessageTransport,
  ): Promise<void> {
    if (!sessionId || !text.trim()) {
      return;
    }

    const state = this.getOrCreateState(sessionId);
    state.task = state.task
      .catch(() => undefined)
      .then(async () => {
        if (state.lastText === text) {
          return;
        }

        if (state.messageId === undefined) {
          state.messageId = await transport.sendText(text);
        } else {
          await transport.editText(state.messageId, text);
        }

        state.lastText = text;
      })
      .catch((error) => {
        logger.error(`[ThinkingLifecycle] Failed to render thinking message for session=${sessionId}`, error);
      });

    await state.task;
  }

  async finalize(
    sessionId: string,
    shouldClear: boolean,
    transport: ThinkingMessageTransport,
  ): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    await state.task.catch(() => undefined);

    if (shouldClear && state.messageId !== undefined) {
      try {
        await transport.deleteText(state.messageId);
      } catch (error) {
        logger.error(
          `[ThinkingLifecycle] Failed to delete thinking message for session=${sessionId}`,
          error,
        );
      }
    }

    this.states.delete(sessionId);
  }

  clearSession(sessionId: string): void {
    this.states.delete(sessionId);
  }

  clearAll(): void {
    this.states.clear();
  }

  private getOrCreateState(sessionId: string): ThinkingMessageState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: ThinkingMessageState = {
      lastText: "",
      task: Promise.resolve(),
    };
    this.states.set(sessionId, created);
    return created;
  }
}
