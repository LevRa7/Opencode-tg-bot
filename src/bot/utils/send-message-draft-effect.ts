import type { Api, RawApi } from "grammy";
import { logger } from "../../utils/logger.js";
import {
  SequentialMessageDraftIdAllocator,
  type MessageDraftIdAllocator,
} from "./message-draft-id.js";

type SendMessageDraftApi = Pick<Api<RawApi>, "sendMessageDraft">;

interface DraftEffectPayload {
  chat_id?: number | string;
  message_thread_id?: number;
  text?: string;
  parse_mode?: string;
  entities?: unknown;
}

interface AbortSignalLike {
  aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;
const DRAFT_EFFECT_STEP_DELAY_MS = 45;

function delay(ms: number, signal?: AbortSignalLike): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("Draft effect aborted"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function buildDraftFrames(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const safeText =
    normalized.length > TELEGRAM_MESSAGE_LIMIT
      ? normalized.slice(0, TELEGRAM_MESSAGE_LIMIT)
      : normalized;

  if (safeText.length <= 8) {
    return [safeText];
  }

  const stepOneLength = Math.max(1, Math.floor(safeText.length * 0.35));
  const stepTwoLength = Math.max(stepOneLength + 1, Math.floor(safeText.length * 0.7));

  return Array.from(
    new Set([safeText.slice(0, stepOneLength), safeText.slice(0, stepTwoLength), safeText]),
  );
}

function buildHtmlDraftFrames(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const blockquoteMatch = normalized.match(
    /^(?<prefix>[\s\S]*?)<blockquote expandable>(?<body>[\s\S]*)<\/blockquote>$/,
  );

  if (!blockquoteMatch?.groups) {
    return [
      normalized.length > TELEGRAM_MESSAGE_LIMIT
        ? normalized.slice(0, TELEGRAM_MESSAGE_LIMIT)
        : normalized,
    ];
  }

  const prefix = blockquoteMatch.groups.prefix.trimEnd();
  const body = blockquoteMatch.groups.body.trim();
  const bodySections = body
    .split(/\n\n+/)
    .map((section) => section.trim())
    .filter(Boolean);

  if (bodySections.length === 0) {
    return [normalized];
  }

  const frames: string[] = [];
  for (let index = 0; index < bodySections.length; index += 1) {
    const renderedBody = bodySections.slice(0, index + 1).join("\n\n");
    const frame = `${prefix}\n\n<blockquote expandable>${renderedBody}</blockquote>`;
    frames.push(
      frame.length > TELEGRAM_MESSAGE_LIMIT ? frame.slice(0, TELEGRAM_MESSAGE_LIMIT) : frame,
    );
  }

  return Array.from(new Set(frames));
}

export class SendMessageDraftEffectManager {
  constructor(
    private readonly draftIdAllocator: MessageDraftIdAllocator = new SequentialMessageDraftIdAllocator(),
  ) {}

  async play(
    api: SendMessageDraftApi,
    payload: DraftEffectPayload,
    signal?: AbortSignalLike,
  ): Promise<void> {
    if (typeof payload.chat_id !== "number" || typeof payload.text !== "string") {
      return;
    }

    if (payload.entities) {
      return;
    }

    if (payload.parse_mode && payload.parse_mode !== "HTML") {
      return;
    }

    const frames =
      payload.parse_mode === "HTML"
        ? buildHtmlDraftFrames(payload.text)
        : buildDraftFrames(payload.text);
    if (frames.length === 0) {
      return;
    }

    const draftId = this.draftIdAllocator.next();

    try {
      for (let index = 0; index < frames.length; index++) {
        await api.sendMessageDraft(payload.chat_id, draftId, frames[index], {
          ...(typeof payload.message_thread_id === "number"
            ? { message_thread_id: payload.message_thread_id }
            : {}),
          ...(payload.parse_mode === "HTML" ? { parse_mode: "HTML" } : {}),
        });

        if (index < frames.length - 1) {
          await delay(DRAFT_EFFECT_STEP_DELAY_MS, signal);
        }
      }
    } catch (error) {
      logger.debug("[Bot] Draft effect skipped for sendMessage", error);
    }
  }
}
