import { logger } from "../../utils/logger.js";

interface ThinkingMessageTransport {
  sendText: (text: string) => Promise<number>;
  editText: (messageId: number, text: string) => Promise<void>;
  deleteText: (messageId: number) => Promise<void>;
  routingIdentity?: string;
}

interface ThinkingMessageState {
  messageId?: number;
  routingIdentity?: string;
  lastText: string;
  task: Promise<void>;
  nextRenderId: number;
  finalizeCutoffRenderId?: number;
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
    const renderId = ++state.nextRenderId;
    state.task = state.task
      .catch(() => undefined)
      .then(async () => {
        if (state.finalizeCutoffRenderId !== undefined && renderId > state.finalizeCutoffRenderId) {
          return;
        }

        if (this.hasRoutingMismatch(state, transport)) {
          // Fixed in 2026-04: once the route changes, the old message must be forgotten so the new route sends fresh.
          state.messageId = undefined;
          state.routingIdentity = undefined;
          state.lastText = "";
        }

        if (state.lastText === text) {
          return;
        }

        if (state.messageId === undefined) {
          state.messageId = await transport.sendText(text);
          state.routingIdentity = transport.routingIdentity;
        } else {
          await transport.editText(state.messageId, text);
        }

        state.lastText = text;
      })
      .catch((error) => {
        logger.error(`[ThinkingLifecycle] Failed to render thinking message for session=${sessionId}`, error);
        throw error;
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

    // Finalize keeps the already-scheduled active block work, but rejects later stale renders on the same state.
    state.finalizeCutoffRenderId = state.nextRenderId;

    await state.task.catch(() => undefined);

    if (
      shouldClear &&
      state.messageId !== undefined &&
      (state.routingIdentity === undefined || state.routingIdentity === transport.routingIdentity)
    ) {
      try {
        await transport.deleteText(state.messageId);
      } catch (error) {
        logger.error(
          `[ThinkingLifecycle] Failed to delete thinking message for session=${sessionId}`,
          error,
        );
      }
    } else if (shouldClear && state.messageId !== undefined && state.routingIdentity !== transport.routingIdentity) {
      logger.warn(
        `[ThinkingLifecycle] Refusing to delete thinking message for session=${sessionId} because routing changed`,
        {
          expectedRoutingIdentity: state.routingIdentity,
          actualRoutingIdentity: transport.routingIdentity,
        },
      );
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
      nextRenderId: 0,
      task: Promise.resolve(),
    };
    this.states.set(sessionId, created);
    return created;
  }

  private hasRoutingMismatch(
    state: ThinkingMessageState,
    transport: ThinkingMessageTransport,
  ): boolean {
    return (
      state.messageId !== undefined &&
      state.routingIdentity !== undefined &&
      transport.routingIdentity !== undefined &&
      state.routingIdentity !== transport.routingIdentity
    );
  }
}
