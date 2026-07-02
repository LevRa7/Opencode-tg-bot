import type { Context } from "grammy";
import { formatLiveLocationTag, formatMovementTag, getLiveLocationTimezone } from "../bot/live-location.js";

export type DeferredItemKind = "text" | "photo" | "document" | "audio" | "video";

type DeferredMediaItemKind = Extract<DeferredItemKind, "photo" | "document" | "audio" | "video">;

const DEFERRED_MEDIA_ITEM_KINDS: ReadonlySet<DeferredMediaItemKind> = new Set([
  "photo",
  "document",
  "audio",
  "video",
]);

export interface ForwardedSourceInfo {
  displayName?: string;
  isFromAnotherUser?: boolean;
}

export interface MessageMetadata {
  liveLocationTag?: string;
  movementTag?: string;
  timezoneOffset?: number;
  senderFirstName?: string;
  senderLastName?: string;
  senderUsername?: string;
  senderId?: number;
  messageId?: number;
  timestamp?: number;
  forwardFromName?: string;
  forwardFromId?: number;
  forwardFromUsername?: string;
  languageCode?: string;
}

export interface CorrelatedIncomingItem {
  correlationId: string;
  kind: DeferredItemKind;
  directText?: string;
  caption?: string;
  previewText?: string;
  contextText?: string;
  forwardedSource?: ForwardedSourceInfo;
}

export interface ResolvedDeferredItem {
  correlationId: string;
  kind: DeferredItemKind;
  directText?: string;
  caption?: string;
  previewText?: string;
  contextText?: string;
  forwardedSource?: ForwardedSourceInfo;
  forwardedTag?: string;
  ctx?: Context;
  metadata?: MessageMetadata;
}

export interface ComposedPromptResult {
  directText?: string;
  previewText?: string;
  contextText?: string;
  forwardedTag?: string;
}

export function isDeferredMediaItem(item: Pick<CorrelatedIncomingItem, "kind">): boolean {
  return DEFERRED_MEDIA_ITEM_KINDS.has(item.kind as DeferredMediaItemKind);
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function createForwardedSourceTag(
  source: ForwardedSourceInfo | undefined,
  t: TranslateFn,
): string {
  const displayName = source?.displayName?.trim();
  if (displayName) {
    return t("deferred.forwarded.from_display", { displayName });
  }

  if (source?.isFromAnotherUser) {
    return t("deferred.forwarded.from_another_user");
  }

  return t("deferred.forwarded.generic");
}

export function formatMetadataLine(m: MessageMetadata | undefined, label: string): string {
  if (!m) return label;

  const tags: string[] = [];

  const quoted = (value: string): string => JSON.stringify(value);
  const formatTimestampTag = (timestamp: number, offsetSeconds?: number): string => {
    const date = new Date(timestamp * 1000);
    if (offsetSeconds !== undefined) {
      // Convert UTC timestamp to local timezone
      const localTimestamp = timestamp + offsetSeconds;
      const localDate = new Date(localTimestamp * 1000);
      const iso = localDate.toISOString().replace("T", " ").slice(0, 19);
      const sign = offsetSeconds >= 0 ? "+" : "-";
      const absHours = Math.floor(Math.abs(offsetSeconds) / 3600);
      const absMins = Math.floor((Math.abs(offsetSeconds) % 3600) / 60);
      const hh = String(absHours).padStart(2, "0");
      const mm = String(absMins).padStart(2, "0");
      return `[datetime=${quoted(`${iso} UTC${sign}${hh}:${mm}`)}]`;
    }
    const iso = date.toISOString().replace("T", " ").slice(0, 19);
    return `[datetime=${quoted(`${iso} UTC`)}]`;
  };

  const name = [m.senderFirstName, m.senderLastName].filter(Boolean).join(" ").trim();
  if (name) {
    tags.push(`[name=${quoted(name)}]`);
  }

  if (typeof m.timestamp === "number" && Number.isFinite(m.timestamp)) {
    tags.push(formatTimestampTag(m.timestamp, m.timezoneOffset));
  }

  if (m.languageCode) {
    tags.push(`[${m.languageCode.toUpperCase()}]`);
  }

  if (m.forwardFromName) {
    tags.push(`[forwarded_at_name=${quoted(m.forwardFromName)}]`);
  }

  if (m.liveLocationTag) {
    tags.push(m.liveLocationTag);
  }

  if (m.movementTag) {
    tags.push(m.movementTag);
  }

  const metaStr = tags.join(" ");
  return label ? `${label}${metaStr ? ` ${metaStr}` : ""}` : metaStr;
}

export function extractMessageMetadata(ctx: Context): MessageMetadata | undefined {
  const msg = ctx?.message;
  if (!msg) return undefined;

  const from = msg.from;
  const fo = msg.forward_origin;

  let forwardFromName: string | undefined;
  let forwardFromId: number | undefined;
  let forwardFromUsername: string | undefined;

  if (fo) {
    if (fo.type === "user" && fo.sender_user) {
      forwardFromName = [fo.sender_user.first_name, fo.sender_user.last_name].filter(Boolean).join(" ");
      forwardFromId = fo.sender_user.id;
      forwardFromUsername = fo.sender_user.username;
    } else if (fo.type === "channel" && fo.chat) {
      forwardFromName = fo.chat.title;
      forwardFromUsername = fo.chat.username;
    } else if (fo.type === "chat" && fo.sender_chat) {
      forwardFromName = fo.sender_chat.title;
      forwardFromUsername = fo.sender_chat.username;
    } else if (fo.type === "hidden_user" && fo.sender_user_name) {
      forwardFromName = fo.sender_user_name;
    }
  }

  const liveLocationTag = from?.id ? formatLiveLocationTag(from.id) : undefined;
  const movementTag = from?.id ? formatMovementTag(from.id) : undefined;
  const tz = from?.id ? getLiveLocationTimezone(from.id) : undefined;
  const timezoneOffset = tz?.utcOffset;

  return {
    liveLocationTag,
    movementTag,
    timezoneOffset,
    senderFirstName: from?.first_name,
    senderLastName: from?.last_name,
    senderUsername: from?.username,
    senderId: from?.id,
    messageId: msg.message_id,
    timestamp: msg.date,
    forwardFromName,
    forwardFromId,
    forwardFromUsername,
    languageCode: from?.language_code,
  };
}
