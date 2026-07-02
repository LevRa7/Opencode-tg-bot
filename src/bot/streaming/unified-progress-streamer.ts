import {
  buildProgressHtml,
  type ToolEntry,
  type ToolStatus,
} from "./unified-progress-html.js";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

export interface UnifiedProgressOptions {
  sendText: (chatId: number, text: string, threadId?: number) => Promise<number>;
  editText: (chatId: number, messageId: number, text: string) => Promise<void>;
  deleteText: (chatId: number, messageId: number) => Promise<void>;
}

interface SessionState {
  sessionTitle: string;
  chatId: number;
  threadId?: number;
  rootMessageId: number | null;
  overflowIds: number[];
  toolEntries: Map<string, ToolEntry>;
  reasoningBlocks: string[];
  reasoningTitle?: string;
  reasoningCounter: number;
  flushTimer: ReturnType<typeof setInterval> | null;
  dirty: boolean;
  inFlight: boolean;
  destroyed: boolean;
  finalized: boolean;
  projectPath: string;
}

export class UnifiedProgressStreamer {
  private sessions = new Map<string, SessionState>();
  private options: UnifiedProgressOptions;
  private flushIntervalMs: number;

  /** Session IDs that were cleared via clearAll() and should NOT be re-created.
   *  Prevents duplicate RichMessages when SSE events for an old session
   *  arrive after the user starts a new prompt. */
  readonly clearedSessions = new Set<string>();

  constructor(options: UnifiedProgressOptions) {
    this.options = options;
    this.flushIntervalMs = config.bot.richProgressFlushIntervalMs;
  }

  async start(
    sessionId: string,
    chatId: number,
    sessionTitle: string,
    threadId?: number,
    projectPath?: string,
  ): Promise<void> {
    logger.debug("[UnifiedProgress] start", { sessionId, chatId, threadId });

    const state: SessionState = {
      sessionTitle,
      chatId,
      threadId,
      rootMessageId: null,
      overflowIds: [],
      toolEntries: new Map(),
      reasoningBlocks: [],
      reasoningCounter: 0,
      flushTimer: null,
      dirty: false,
      inFlight: false,
      destroyed: false,
      finalized: false,
      projectPath: projectPath || "",
    };

    const html = buildProgressHtml({
      sessionTitle: state.sessionTitle,
      toolEntries: [],
      reasoningBlocks: [],
      reasoningTitle: undefined,
      doneCount: 0,
      totalCount: 0,
      projectPath: state.projectPath,
    });

    state.rootMessageId = await this.options.sendText(chatId, html, threadId);
    logger.debug("[UnifiedProgress] start created rootMessageId", { sessionId, rootMessageId: state.rootMessageId });

    // Session was recreated legitimately — remove from cleared set
    this.clearedSessions.delete(sessionId);
    this.sessions.set(sessionId, state);

    state.flushTimer = setInterval(() => {
      void this.flush(sessionId);
    }, this.flushIntervalMs);
  }

  addToolCall(
    sessionId: string,
    info: {
      callId: string;
      title: string;
      category: string;
      tool?: string;
      input?: Record<string, unknown>;
    },
  ): void {
    const state = this.getSession(sessionId);
    state.toolEntries.set(info.callId, {
      callId: info.callId,
      title: info.title,
      category: info.category,
      status: "running",
      tool: info.tool,
      input: info.input,
    });
    state.dirty = true;
    // Flush immediately so running tool appears before it completes
    void this.flushNow(sessionId);
  }

  updateToolCall(
    sessionId: string,
    callId: string,
    update: {
      status?: ToolStatus;
      metric?: string;
      output?: string;
      tool?: string;
      input?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      stateOutput?: unknown;
      title?: string;
    },
  ): void {
    const state = this.getSession(sessionId);
    const entry = state.toolEntries.get(callId);
    if (!entry) return;
    if (update.status !== undefined) entry.status = update.status;
    if (update.metric !== undefined) entry.metric = update.metric;
    if (update.output !== undefined) entry.output = update.output;
    if (update.tool !== undefined) entry.tool = update.tool;
    if (update.input !== undefined) entry.input = update.input;
    if (update.metadata !== undefined) entry.metadata = update.metadata;
    if (update.stateOutput !== undefined) entry.stateOutput = update.stateOutput;
    if (update.title !== undefined) entry.title = update.title;
    state.dirty = true;
    // Flush immediately so completed/errored status appears right away
    void this.flushNow(sessionId);
  }

  addReasoning(sessionId: string, text: string, title?: string): void {
    const state = this.getSession(sessionId);
    state.reasoningBlocks.push(text);
    if (title) {
      state.reasoningTitle = title;
    }
    state.dirty = true;
  }

  /** Replace last reasoning block — pushes old to tool entries only when title changes. */
  setReasoning(sessionId: string, text: string, title?: string): void {
    const state = this.getSession(sessionId);
    const titleChanged = title && title !== state.reasoningTitle;
    if (state.reasoningBlocks.length > 0 && titleChanged) {
      // Title changed — old block is complete, move to tool entries
      const old = state.reasoningBlocks[state.reasoningBlocks.length - 1];
      if (old.trim()) {
        const id = `reasoning-${++state.reasoningCounter}`;
        state.toolEntries.set(id, {
          callId: id,
          title: old.trim(),
          category: "reasoning",
          status: "done",
          tool: "reasoning",
        });
      }
      state.reasoningBlocks[state.reasoningBlocks.length - 1] = text;
    } else if (state.reasoningBlocks.length > 0) {
      // Same title — streaming update, just replace in place
      state.reasoningBlocks[state.reasoningBlocks.length - 1] = text;
    } else {
      state.reasoningBlocks.push(text);
    }
    if (title) {
      state.reasoningTitle = title;
    }
    state.dirty = true;
  }

  async finalize(sessionId: string): Promise<void> {
    const state = this.getSession(sessionId);
    if (state.destroyed) return;

    this.clearTimer(state);

    for (const entry of Array.from(state.toolEntries.values())) {
      if (entry.status === "running" || entry.status === "queued") {
        entry.status = "done";
      }
    }

    state.dirty = true;

    while (state.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.flushNow(sessionId);

    // Finalize marks completion but does NOT destroy session.
    // Session stays alive for subsequent messages in the same response.
    // Only abort() or clearAll() actually destroy.
    state.finalized = true;
  }

  async abort(sessionId: string, reason?: string): Promise<void> {
    const state = this.getSession(sessionId);
    if (state.destroyed) return;

    this.clearTimer(state);

    for (const entry of Array.from(state.toolEntries.values())) {
      if (entry.status !== "done") {
        entry.status = "error";
      }
    }

    if (reason) {
      state.reasoningBlocks.push(reason);
    }

    state.dirty = true;

    while (state.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.flushNow(sessionId);

    state.destroyed = true;
    this.sessions.delete(sessionId);
  }

  hasSession(sessionId: string): boolean {
    if (this.clearedSessions.has(sessionId)) return false;
    const state = this.sessions.get(sessionId);
    return state !== undefined && !state.destroyed;
  }

  hasToolCall(sessionId: string, callId: string): boolean {
    const state = this.sessions.get(sessionId);
    if (!state || state.destroyed) return false;
    return state.toolEntries.has(callId);
  }

  clearAll(): void {
    logger.debug("[UnifiedProgress] clearAll");
    for (const [sId, state] of Array.from(this.sessions)) {
      this.clearTimer(state);
      this.clearedSessions.add(sId);
    }
    this.sessions.clear();
    // Prevent unbounded growth — keep last 100 cleared session IDs
    if (this.clearedSessions.size > 100) {
      const toRemove = Array.from(this.clearedSessions).slice(0, 50);
      for (const sId of toRemove) this.clearedSessions.delete(sId);
    }
  }

  /**
   * Destroy a session without final flush — just remove state.
   * Use when the session's RichMessage should be abandoned
   * (e.g. new user prompt requires fresh message).
   * Does NOT delete the old message from chat — it stays as a completed record.
   */
  destroy(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this.clearTimer(state);
    this.sessions.delete(sessionId);
  }

  /** Test-only: returns internal session state for test assertions. */
  _getSessionForTesting(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  // ── private ──────────────────────────────────────────────────

  private getSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`UnifiedProgressStreamer: session ${sessionId} not found`);
    }
    return state;
  }

  private clearTimer(state: SessionState): void {
    if (state.flushTimer !== null) {
      clearInterval(state.flushTimer);
      state.flushTimer = null;
    }
  }

  private async flush(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.destroyed) return;
    if (!state.dirty) return;
    if (state.inFlight) return;

    await this.flushNow(sessionId);
  }

  private async flushNow(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.destroyed) return;
    if (state.inFlight) return;

    state.inFlight = true;
    state.dirty = false;

    try {
      await this.performFlush(state);
    } catch (err: unknown) {
      logger.warn("[UnifiedProgress] performFlush threw", { sessionId, err });
      state.dirty = true;
      await this.handleFlushError(state, err, sessionId);
    } finally {
      state.inFlight = false;
    }
  }

  private buildHtml(state: SessionState): string {
    const entries = Array.from(state.toolEntries.values());
    const doneCount = entries.filter((e) => e.status === "done").length;
    const totalCount = entries.length;

    return buildProgressHtml({
      sessionTitle: state.sessionTitle,
      toolEntries: entries,
      reasoningBlocks: state.reasoningBlocks,
      reasoningTitle: state.reasoningTitle,
      doneCount,
      totalCount,
      projectPath: state.projectPath,
    });
  }

  private async performFlush(state: SessionState): Promise<void> {
    const html = this.buildHtml(state);

    if (state.rootMessageId !== null) {
      logger.debug("[UnifiedProgress] performFlush edit", { rootMessageId: state.rootMessageId });
      await this.options.editText(state.chatId, state.rootMessageId, html);
    }
  }

  private async handleFlushError(
    state: SessionState,
    err: unknown,
    sessionId: string,
  ): Promise<void> {
    const errObj = err as Record<string, unknown>;
    const description = String(errObj.description ?? "");

    if (
      errObj.error_code === 400 &&
      description.includes("message is not modified")
    ) {
      state.dirty = false;
      return;
    }

    if (
      errObj.error_code === 400 &&
      description.includes("message to edit not found")
    ) {
      logger.warn(
        "[UnifiedProgress] Root message deleted, recreating",
        { sessionId, oldRootMessageId: state.rootMessageId },
      );
      const html = this.buildHtml(state);

      try {
        state.rootMessageId = await this.options.sendText(
          state.chatId,
          html,
          state.threadId,
        );
        logger.debug("[UnifiedProgress] Recreated rootMessageId", { sessionId, newRootMessageId: state.rootMessageId });
      } catch (sendErr) {
        logger.error(
          "[UnifiedProgress] Failed to recreate root message",
          { sessionId, err: sendErr },
        );
        return;
      }

      state.dirty = false;
      return;
    }

    logger.error("[UnifiedProgress] Flush error", { sessionId, err, rootMessageId: state.rootMessageId });
  }
}
