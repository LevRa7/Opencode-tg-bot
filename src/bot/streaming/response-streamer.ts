import type { Api, RawApi } from "grammy";
import type { MessageEntity } from "grammy/types";
import { logger } from "../../utils/logger.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export type StreamingMessageFormat = "raw" | "markdown_v2" | "html";

export interface StreamingMessagePayloadPart {
  text: string;
  entities?: MessageEntity[];
}

export interface StreamingMessagePayload {
  parts: (string | StreamingMessagePayloadPart)[];
  format: StreamingMessageFormat;
  sendOptions?: TelegramSendMessageOptions;
  editOptions?: TelegramEditMessageOptions;
}

export interface StreamCompleteResult {
  streamed: boolean;
  telegramMessageIds: number[];
}

interface ResponseStreamerCompleteOptions {
  flushFinal?: boolean;
}

interface ResponseStreamerOptions {
  throttleMs: number;
  sendText: (
    sessionId: string,
    text: string,
    format: StreamingMessageFormat,
    options?: TelegramSendMessageOptions,
  ) => Promise<number>;
  editText: (
    sessionId: string,
    messageId: number,
    text: string,
    format: StreamingMessageFormat,
    options?: TelegramEditMessageOptions,
  ) => Promise<void>;
  deleteText: (sessionId: string, messageId: number) => Promise<void>;
}

interface StreamState {
  key: string;
  sessionId: string;
  messageId: string;
  latestPayload: StreamingMessagePayload | null;
  lastSentSignatures: string[];
  telegramMessageIds: number[];
  timer: ReturnType<typeof setTimeout> | null;
  task: Promise<boolean>;
  cancelled: boolean;
  isBroken: boolean;
  fatalErrorMessage: string | null;
  fatalErrorLogged: boolean;
}

function buildStateKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

function normalizePayload(payload: StreamingMessagePayload): StreamingMessagePayload | null {
   const normalizedParts = payload.parts
     .map((part) => {
       if (typeof part === "string") {
         return { text: part.trim() };
       }
       return {
         text: part.text.trim(),
         entities: part.entities,
       };
     })
     .filter((part) => part.text.length > 0);
  if (normalizedParts.length === 0) {
    return null;
  }

  return {
    parts: normalizedParts,
    format: payload.format,
    sendOptions: payload.sendOptions,
    editOptions: payload.editOptions,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getRetryAfterMs(error: unknown): number | null {
  const message = getErrorMessage(error);
  if (!/\b429\b/.test(message)) {
    return null;
  }

  const retryMatch = message.match(/retry after\s+(\d+)/i);
  if (!retryMatch) {
    return null;
  }

  const seconds = Number.parseInt(retryMatch[1], 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return seconds * 1000;
}

function createSignature(part: string | StreamingMessagePayloadPart, format: StreamingMessageFormat): string {
  const text = typeof part === "string" ? part : part.text;
  const entities = typeof part === "string" ? undefined : part.entities;
  const entitiesKey = entities ? JSON.stringify(entities) : 'null';
  return `${format}\n${text}\n${entitiesKey}`;
}

function resolvePartFormat(
  part: string | StreamingMessagePayloadPart,
  payloadFormat: StreamingMessageFormat,
): StreamingMessageFormat {
  if (payloadFormat !== "markdown_v2") {
    return payloadFormat;
  }

  if (typeof part === "string") {
    return "raw";
  }

  return part.entities?.length ? "markdown_v2" : "raw";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ResponseStreamer {
  private readonly throttleMs: number;
  private readonly sendText: ResponseStreamerOptions["sendText"];
  private readonly editText: ResponseStreamerOptions["editText"];
  private readonly deleteText: ResponseStreamerOptions["deleteText"];
  private readonly states: Map<string, StreamState> = new Map();

  constructor(options: ResponseStreamerOptions) {
    this.throttleMs = Math.max(0, Math.floor(options.throttleMs));
    this.sendText = options.sendText;
    this.editText = options.editText;
    this.deleteText = options.deleteText;
  }

  enqueue(sessionId: string, messageId: string, payload: StreamingMessagePayload): void {
    const normalizedPayload = normalizePayload(payload);
    if (!normalizedPayload) {
      return;
    }

    const state = this.getOrCreateState(sessionId, messageId);
    state.latestPayload = normalizedPayload;
    if (state.isBroken) {
      return;
    }

    this.ensureTimer(state);
  }

  async complete(
    sessionId: string,
    messageId: string,
    payload?: StreamingMessagePayload,
    options?: ResponseStreamerCompleteOptions,
  ): Promise<StreamCompleteResult> {
    const notStreamed: StreamCompleteResult = { streamed: false, telegramMessageIds: [] };

    const state = this.states.get(buildStateKey(sessionId, messageId));
    if (!state) {
      return notStreamed;
    }

    if (payload) {
      const normalizedPayload = normalizePayload(payload);
      if (normalizedPayload) {
        state.latestPayload = normalizedPayload;
      }
    }

    this.clearTimer(state);

    await state.task.catch(() => false);

    if (state.isBroken) {
      await this.cleanupBrokenStream(state, "complete_broken_stream");
      this.cancelState(state);
      this.states.delete(state.key);
      return notStreamed;
    }

    if (state.telegramMessageIds.length === 0) {
      this.cancelState(state);
      this.states.delete(state.key);
      return notStreamed;
    }

    let synced = true;
    if (options?.flushFinal !== false) {
      synced = await this.enqueueTask(state, () => this.flushState(state, "complete"));
      if (!synced && state.isBroken) {
        await this.cleanupBrokenStream(state, "final_sync_failed_cleanup");
      }
    }

    const messageIds = [...state.telegramMessageIds];
    this.cancelState(state);
    this.states.delete(state.key);
    return { streamed: synced, telegramMessageIds: messageIds };
  }

  clearMessage(sessionId: string, messageId: string, reason: string): void {
    const key = buildStateKey(sessionId, messageId);
    const state = this.states.get(key);
    if (!state) {
      return;
    }

    this.cancelState(state);
    this.states.delete(key);
    logger.debug(
      `[ResponseStreamer] Cleared message stream: session=${sessionId}, message=${messageId}, reason=${reason}`,
    );
  }

  clearSession(sessionId: string, reason: string): void {
    for (const state of Array.from(this.states.values())) {
      if (state.sessionId !== sessionId) {
        continue;
      }

      this.cancelState(state);
      this.states.delete(state.key);
    }

    logger.debug(
      `[ResponseStreamer] Cleared session streams: session=${sessionId}, reason=${reason}`,
    );
  }

  clearAll(reason: string): void {
    for (const state of this.states.values()) {
      this.cancelState(state);
    }

    const count = this.states.size;
    this.states.clear();

    if (count > 0) {
      logger.debug(`[ResponseStreamer] Cleared all streams: count=${count}, reason=${reason}`);
    }
  }

  private getOrCreateState(sessionId: string, messageId: string): StreamState {
    const key = buildStateKey(sessionId, messageId);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const state: StreamState = {
      key,
      sessionId,
      messageId,
      latestPayload: null,
      lastSentSignatures: [],
      telegramMessageIds: [],
      timer: null,
      task: Promise.resolve(true),
      cancelled: false,
      isBroken: false,
      fatalErrorMessage: null,
      fatalErrorLogged: false,
    };

    this.states.set(key, state);
    return state;
  }

  private ensureTimer(state: StreamState): void {
    if (state.timer || state.cancelled) {
      return;
    }

    if (this.throttleMs === 0) {
      void this.enqueueTask(state, () => this.flushState(state, "immediate")).catch((error) => {
        logger.error(
          `[ResponseStreamer] Immediate stream sync failed: session=${state.sessionId}, message=${state.messageId}`,
          error,
        );
      });
      return;
    }

    state.timer = setTimeout(() => {
      state.timer = null;
      void this.enqueueTask(state, () => this.flushState(state, "throttle_elapsed")).catch(
        (error) => {
          logger.error(
            `[ResponseStreamer] Throttled stream sync failed: session=${state.sessionId}, message=${state.messageId}`,
            error,
          );
        },
      );
    }, this.throttleMs);
  }

  private clearTimer(state: StreamState): void {
    if (!state.timer) {
      return;
    }

    clearTimeout(state.timer);
    state.timer = null;
  }

  private cancelState(state: StreamState): void {
    state.cancelled = true;
    this.clearTimer(state);
  }

  private enqueueTask(state: StreamState, task: () => Promise<boolean>): Promise<boolean> {
    const nextTask = state.task.catch(() => false).then(task);
    state.task = nextTask;
    return nextTask;
  }

  private async flushState(state: StreamState, reason: string): Promise<boolean> {
    if (state.cancelled) {
      return false;
    }

    if (state.isBroken) {
      return false;
    }

    while (!state.cancelled) {
      const payload = state.latestPayload;
      if (!payload) {
        return state.telegramMessageIds.length > 0;
      }

      const targetSignatures = payload.parts.map((part) => createSignature(part, payload.format));
      const unchanged =
        targetSignatures.length === state.lastSentSignatures.length &&
        targetSignatures.every((signature, index) => signature === state.lastSentSignatures[index]);

      if (unchanged) {
        return state.telegramMessageIds.length > 0;
      }

      try {
        await this.syncMessages(state, payload, targetSignatures);
        logger.debug(
          `[ResponseStreamer] Stream synced: session=${state.sessionId}, message=${state.messageId}, reason=${reason}, parts=${payload.parts.length}`,
        );
        return true;
      } catch (error) {
        const retryAfterMs = getRetryAfterMs(error);
        if (retryAfterMs === null) {
          this.markStreamBroken(state, error, reason);
          return false;
        }

        const delayMs = Math.max(this.throttleMs, retryAfterMs);
        logger.warn(
          `[ResponseStreamer] Stream sync rate-limited, retrying in ${delayMs}ms: session=${state.sessionId}, message=${state.messageId}, reason=${reason}`,
          error,
        );
        await delay(delayMs);
      }
    }

    return false;
  }

  private markStreamBroken(state: StreamState, error: unknown, reason: string): void {
    state.isBroken = true;
    state.fatalErrorMessage = getErrorMessage(error);

    if (state.fatalErrorLogged) {
      return;
    }

    state.fatalErrorLogged = true;
    logger.error(
      `[ResponseStreamer] Stream marked as broken: session=${state.sessionId}, message=${state.messageId}, reason=${reason}, error=${state.fatalErrorMessage}`,
      error,
    );
  }

  private async cleanupBrokenStream(state: StreamState, reason: string): Promise<void> {
    if (state.telegramMessageIds.length === 0) {
      return;
    }

    for (let index = state.telegramMessageIds.length - 1; index >= 0; index--) {
      const messageId = state.telegramMessageIds[index];
      if (!messageId) {
        continue;
      }

      try {
        await this.deleteText(state.sessionId, messageId);
      } catch (error) {
        logger.warn(
          `[ResponseStreamer] Failed to delete broken stream message: session=${state.sessionId}, message=${state.messageId}, telegramMessageId=${messageId}, reason=${reason}`,
          error,
        );
      }
    }

    state.telegramMessageIds = [];
    state.lastSentSignatures = [];
    logger.debug(
      `[ResponseStreamer] Cleaned up broken stream messages: session=${state.sessionId}, message=${state.messageId}, reason=${reason}`,
    );
  }

  private async syncMessages(
    state: StreamState,
    payload: StreamingMessagePayload,
    targetSignatures: string[],
  ): Promise<void> {
    for (let index = 0; index < payload.parts.length; index++) {
      const part = payload.parts[index];
      const nextSignature = targetSignatures[index];
      const currentMessageId = state.telegramMessageIds[index];

      const text = typeof part === "string" ? part : part.text;
      const entities = typeof part === "string" ? undefined : part.entities;
      const partFormat = resolvePartFormat(part, payload.format);

      const sendOptions = entities
        ? { ...(payload.sendOptions || {}), entities }
        : payload.sendOptions;
      const editOptions = entities
        ? { ...(payload.editOptions || {}), entities }
        : payload.editOptions;

      if (currentMessageId) {
        if (state.lastSentSignatures[index] === nextSignature) {
          continue;
        }

        await this.editText(state.sessionId, currentMessageId, text, partFormat, editOptions);
        state.lastSentSignatures[index] = nextSignature;
        continue;
      }

      const messageId = await this.sendText(state.sessionId, text, partFormat, sendOptions);
      state.telegramMessageIds[index] = messageId;
      state.lastSentSignatures[index] = nextSignature;
    }

    for (let index = state.telegramMessageIds.length - 1; index >= payload.parts.length; index--) {
      const messageId = state.telegramMessageIds[index];
      if (messageId) {
        await this.deleteText(state.sessionId, messageId);
      }
      state.telegramMessageIds.pop();
      state.lastSentSignatures.pop();
    }
  }
}
