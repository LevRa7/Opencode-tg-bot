import { Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import {
  extractCallbackMessageIdFromContext,
  extractMessageThreadIdFromContext,
  withMessageThreadId,
} from "../utils/message-thread.js";

const INLINE_MENU_CANCEL_PREFIX = "inline:cancel:";
const LEGACY_CONTEXT_CANCEL_CALLBACK = "compact:cancel";
const INLINE_MENU_TTL_MS = 5 * 60 * 1000;

const INLINE_MENU_KINDS = ["project", "session", "model", "agent", "variant", "context", "ontology", "open", "worktree"] as const;

export type InlineMenuKind = (typeof INLINE_MENU_KINDS)[number];

interface ActiveInlineMenuMetadata {
  menuKind: InlineMenuKind;
  messageId: number;
}

interface InlineMenuReplyOptions {
  menuKind: InlineMenuKind;
  text: string;
  keyboard: InlineKeyboard;
  parseMode?: "Markdown" | "HTML";
  messageThreadId?: number;
}

function isInlineMenuKind(value: string): value is InlineMenuKind {
  return INLINE_MENU_KINDS.includes(value as InlineMenuKind);
}

function getActiveInlineMenuMetadata(
  state: InteractionState | null,
): ActiveInlineMenuMetadata | null {
  if (!state || state.kind !== "inline") {
    return null;
  }

  const menuKind = state.metadata.menuKind;
  const messageId = state.metadata.messageId;

  if (typeof menuKind !== "string" || !isInlineMenuKind(menuKind)) {
    return null;
  }

  if (typeof messageId !== "number") {
    return null;
  }

  return {
    menuKind,
    messageId,
  };
}

function getInlineCancelCallbackData(menuKind: InlineMenuKind): string {
  return `${INLINE_MENU_CANCEL_PREFIX}${menuKind}`;
}

export function appendInlineMenuCancelButton(
  keyboard: InlineKeyboard,
  menuKind: InlineMenuKind,
): InlineKeyboard {
  while (
    keyboard.inline_keyboard.length > 0 &&
    keyboard.inline_keyboard[keyboard.inline_keyboard.length - 1].length === 0
  ) {
    keyboard.inline_keyboard.pop();
  }

  if (keyboard.inline_keyboard.length > 0) {
    keyboard.row();
  }

  keyboard.text(t("inline.button.cancel"), getInlineCancelCallbackData(menuKind));
  return keyboard;
}

export async function replyWithInlineMenu(
  ctx: Context,
  options: InlineMenuReplyOptions,
): Promise<number> {
  const keyboard = appendInlineMenuCancelButton(options.keyboard, options.menuKind);
  const replyOptions: {
    reply_markup: InlineKeyboard;
    parse_mode?: "Markdown" | "HTML";
  } = {
    reply_markup: keyboard,
  };

  if (options.parseMode) {
    replyOptions.parse_mode = options.parseMode;
  }

  const messageThreadId = options.messageThreadId ?? extractMessageThreadIdFromContext(ctx);
  logger.info(
    `[InlineMenu] Sending menu: kind=${options.menuKind}, chatId=${ctx.chat?.id ?? "unknown"}, threadId=${messageThreadId ?? "none"}, parseMode=${options.parseMode ?? "raw"}, textLength=${options.text.length}`,
  );

  try {
    const message = await ctx.reply(options.text, withMessageThreadId(replyOptions, messageThreadId));

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      expiresInMs: INLINE_MENU_TTL_MS,
      metadata: {
        menuKind: options.menuKind,
        messageId: message.message_id,
      },
    });

    logger.info(
      `[InlineMenu] Opened menu: kind=${options.menuKind}, chatId=${ctx.chat?.id ?? "unknown"}, threadId=${messageThreadId ?? "none"}, messageId=${message.message_id}`,
    );

    return message.message_id;
  } catch (error) {
    logger.error(
      `[InlineMenu] Failed to send menu: kind=${options.menuKind}, chatId=${ctx.chat?.id ?? "unknown"}, threadId=${messageThreadId ?? "none"}, parseMode=${options.parseMode ?? "raw"}, textLength=${options.text.length}`,
      error,
    );
    throw error;
  }
}

export async function ensureActiveInlineMenu(
  ctx: Context,
  menuKind: InlineMenuKind,
): Promise<boolean> {
  const activeMetadata = getActiveInlineMenuMetadata(interactionManager.getSnapshot());
  const callbackMessageId = extractCallbackMessageIdFromContext(ctx);

  const isActive =
    !!activeMetadata &&
    callbackMessageId !== null &&
    activeMetadata.menuKind === menuKind &&
    activeMetadata.messageId === callbackMessageId;

  if (isActive) {
    return true;
  }

  logger.debug(
    `[InlineMenu] Stale callback ignored: expectedKind=${menuKind}, activeKind=${activeMetadata?.menuKind || "none"}, callbackMessageId=${callbackMessageId || "none"}, activeMessageId=${activeMetadata?.messageId || "none"}`,
  );

  await ctx
    .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
    .catch(() => {});

  return false;
}

export function clearActiveInlineMenu(reason: string): void {
  const state = interactionManager.getSnapshot();
  if (state?.kind === "inline") {
    interactionManager.clear(reason);
  }
}

export async function handleInlineMenuCancel(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  let menuKind: InlineMenuKind | null = null;

  if (data === LEGACY_CONTEXT_CANCEL_CALLBACK) {
    menuKind = "context";
  } else if (data.startsWith(INLINE_MENU_CANCEL_PREFIX)) {
    const rawKind = data.slice(INLINE_MENU_CANCEL_PREFIX.length);
    if (!isInlineMenuKind(rawKind)) {
      return false;
    }

    menuKind = rawKind;
  } else {
    return false;
  }

  const isActive = await ensureActiveInlineMenu(ctx, menuKind);
  if (!isActive) {
    return true;
  }

  clearActiveInlineMenu(`inline_menu_cancel:${menuKind}`);

  await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  logger.debug(`[InlineMenu] Menu cancelled: kind=${menuKind}`);

  return true;
}
