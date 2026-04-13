import type { Api, RawApi } from "grammy";
import { withMessageThreadId, type TelegramThreadTarget } from "./message-thread.js";
import { editBotText, sendBotText, sendBotTextDraft, type TelegramTextFormat } from "./telegram-text.js";
import { logger } from "../../utils/logger.js";
import {
  SequentialMessageDraftIdAllocator,
  type MessageDraftIdAllocator,
} from "./message-draft-id.js";

type DraftApi = Pick<Api<RawApi>, "sendMessageDraft">;
type SendApi = Pick<Api<RawApi>, "sendMessage">;
type EditApi = Pick<Api<RawApi>, "editMessageText">;

interface DraftStreamState {
  draftId: number;
  lastSentAt: number;
  lastSentText: string;
  lastSentFormat: TelegramTextFormat;
  lastSentMessageId: number | null;
  lastPayloadSignature: string | null;
  pendingText: string | null;
  pendingFormat: TelegramTextFormat;
  timer: ReturnType<typeof setTimeout> | null;
  target: TelegramThreadTarget | null;
  api: DraftApi | null;
  sendApi: SendApi | null;
  editApi: EditApi | null;
  disabled: boolean;
  inFlight: boolean;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;
const STREAM_APPEND_MIN_CHARS = 16;
const STREAM_APPEND_MAX_CHARS = 96;
const STREAM_APPEND_WORD_LOOKAHEAD = 24;

function prepareDraftText(text: string, format: TelegramTextFormat): string | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  if (format === "html") {
    return text;
  }

  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }

  return `...${text.slice(-(TELEGRAM_MESSAGE_LIMIT - 3))}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveNextProgressiveText(
  previousText: string,
  nextText: string,
  format: TelegramTextFormat,
): string {
  if (format !== "raw") {
    return nextText;
  }

  if (!nextText.startsWith(previousText)) {
    return nextText;
  }

  const remainingLength = nextText.length - previousText.length;
  if (remainingLength <= STREAM_APPEND_MIN_CHARS) {
    return nextText;
  }

  const preferredAppendLength = clamp(
    Math.ceil(remainingLength * 0.35),
    STREAM_APPEND_MIN_CHARS,
    STREAM_APPEND_MAX_CHARS,
  );
  let nextLength = previousText.length + preferredAppendLength;

  if (nextLength >= nextText.length) {
    return nextText;
  }

  const lookaheadEnd = Math.min(nextText.length, nextLength + STREAM_APPEND_WORD_LOOKAHEAD);
  const lookahead = nextText.slice(nextLength, lookaheadEnd);
  const boundaryOffset = lookahead.search(/[\s.,!?;:)]/);

  if (boundaryOffset >= 0) {
    nextLength += boundaryOffset + 1;
  }

  return nextText.slice(0, nextLength);
}

export class MessageDraftStreamManager {
  private readonly states = new Map<string, DraftStreamState>();

  getLastPayloadSignature(sessionId: string): string | null {
    return this.states.get(sessionId)?.lastPayloadSignature ?? null;
  }

  getLastSentMessageId(sessionId: string): number | null {
    return this.states.get(sessionId)?.lastSentMessageId ?? null;
  }

  consumeLastSentMessageId(sessionId: string): number | null {
    const state = this.states.get(sessionId);
    if (!state) return null;
    const messageId = state.lastSentMessageId;
    state.lastSentMessageId = null;
    return messageId;
  }

  constructor(
    private readonly minIntervalMs = 120,
    private readonly draftIdAllocator: MessageDraftIdAllocator = new SequentialMessageDraftIdAllocator(),
  ) {}

  enqueue(
    sessionId: string,
    api: DraftApi,
    target: TelegramThreadTarget,
    text: string,
    format: TelegramTextFormat = "raw",
  ): void {
    const preparedText = prepareDraftText(text, format);
    if (!preparedText) {
      return;
    }

    const state = this.getOrCreateState(sessionId);
    if (state.disabled) {
      return;
    }

    if (
      (preparedText === state.lastSentText && format === state.lastSentFormat) ||
      (preparedText === state.pendingText && format === state.pendingFormat)
    ) {
      return;
    }

    state.api = api;
    state.target = target;
    state.pendingText = preparedText;
    state.pendingFormat = format;

    if (state.timer) {
      return;
    }

    this.scheduleSession(sessionId);
  }

  setSendEditApi(sessionId: string, sendApi: SendApi, editApi: EditApi): void {
    const state = this.states.get(sessionId);
    if (state) {
      state.sendApi = sendApi;
      state.editApi = editApi;
    }
  }

  async flushSession(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || state.disabled || !state.pendingText || !state.api || !state.target) {
      return;
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.inFlight) {
      return;
    }

    const text = state.pendingText;
    const format = state.pendingFormat;

    state.inFlight = true;
    try {
      await this.sendDraftText(sessionId, state, text, format);
    } finally {
      state.inFlight = false;
    }

    if (!state.disabled && state.pendingText === text && state.pendingFormat === format) {
      state.pendingText = null;
      state.pendingFormat = state.lastSentFormat;
    }
  }

  clearSession(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.states.delete(sessionId);
  }

  clearAll(): void {
    for (const sessionId of this.states.keys()) {
      this.clearSession(sessionId);
    }
  }

  private getOrCreateState(sessionId: string): DraftStreamState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: DraftStreamState = {
      draftId: this.draftIdAllocator.next(),
      lastSentAt: 0,
      lastSentText: "",
      lastSentFormat: "raw",
      lastSentMessageId: null,
      lastPayloadSignature: null,
      pendingText: null,
      pendingFormat: "raw",
      timer: null,
      target: null,
      api: null,
      sendApi: null,
      editApi: null,
      disabled: false,
      inFlight: false,
    };
    this.states.set(sessionId, created);
    return created;
  }

  private scheduleSession(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (!state || state.timer) {
      return;
    }

    const elapsedMs = Date.now() - state.lastSentAt;
    const waitMs = state.lastSentAt === 0 ? 0 : Math.max(this.minIntervalMs - elapsedMs, 0);

    state.timer = setTimeout(() => {
      state.timer = null;
      void this.processSession(sessionId);
    }, waitMs);
  }

  private async processSession(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || state.disabled || !state.pendingText || !state.api || !state.target || state.inFlight) {
      return;
    }

    const pendingText = state.pendingText;
    const pendingFormat = state.pendingFormat;
    const nextText = resolveNextProgressiveText(state.lastSentText, pendingText, pendingFormat);

    state.inFlight = true;
    try {
      await this.sendDraftText(sessionId, state, nextText, pendingFormat);
    } finally {
      state.inFlight = false;
    }

    if (state.disabled) {
      return;
    }

    if (state.pendingText === nextText && state.pendingFormat === pendingFormat) {
      if (nextText === pendingText) {
        state.pendingText = null;
      }
    }

    if (state.pendingText && state.pendingText !== state.lastSentText) {
      this.scheduleSession(sessionId);
      return;
    }

    state.pendingText = null;
  }

  private async sendDraftText(
    sessionId: string,
    state: DraftStreamState,
    text: string,
    format: TelegramTextFormat,
  ): Promise<void> {
    try {
      if (state.lastSentMessageId && state.editApi) {
        await editBotText({
          api: state.editApi,
          chatId: state.target!.chatId,
          messageId: state.lastSentMessageId,
          text,
          options: undefined,
          format,
        });
      } else if (state.sendApi) {
        const messageId = await sendBotText({
          api: state.sendApi,
          chatId: state.target!.chatId,
          text,
          options: withMessageThreadId(undefined, state.target!.messageThreadId),
          format,
          messageThreadId: state.target!.messageThreadId,
        });
        if (messageId) {
          state.lastSentMessageId = messageId;
        }
      } else {
        await sendBotTextDraft({
          api: state.api!,
          chatId: state.target!.chatId,
          draftId: state.draftId,
          text,
          format,
          options: withMessageThreadId(undefined, state.target!.messageThreadId),
        });
      }
      state.lastSentAt = Date.now();
      state.lastSentText = text;
      state.lastSentFormat = format;
      state.lastPayloadSignature = `${format}::${JSON.stringify([text])}`;
    } catch (error) {
      state.disabled = true;
      state.pendingText = null;
      logger.warn(
        `[Bot] Failed to stream assistant draft, disabling drafts for session ${sessionId}`,
        error,
      );
    }
  }
}
