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
  senderFirstName?: string;
  senderLastName?: string;
  senderUsername?: string;
  senderId?: number;
  messageId?: number;
  timestamp?: number;
  forwardFromName?: string;
  forwardFromId?: number;
  forwardFromUsername?: string;
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
  ctx?: any;
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

  const parts: string[] = [];

  if (m.senderFirstName || m.senderLastName) {
    const name = [m.senderFirstName, m.senderLastName].filter(Boolean).join(" ");
    parts.push(`👤 ${name}`);
  } else if (m.senderUsername) {
    parts.push(`👤 @${m.senderUsername}`);
  }

  if (m.senderId) {
    parts.push(`🆔 ${m.senderId}`);
  }

  if (m.messageId) {
    parts.push(`#msg${m.messageId}`);
  }

  if (m.timestamp) {
    const d = new Date(m.timestamp * 1000);
    const time = d.toLocaleString("ru-RU", {
      day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
    parts.push(`🕐 ${time}`);
  }

  const metaStr = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${label}${metaStr}`;
}

export function extractMessageMetadata(ctx: any): MessageMetadata | undefined {
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
    } else if (fo.type === "chat" && fo.sender_chat) {
      forwardFromName = fo.sender_chat.title;
      forwardFromUsername = fo.sender_chat.username;
    } else if (fo.type === "hidden_user" && fo.sender_user_name) {
      forwardFromName = fo.sender_user_name;
    }
  }

  return {
    senderFirstName: from?.first_name,
    senderLastName: from?.last_name,
    senderUsername: from?.username,
    senderId: from?.id,
    messageId: msg.message_id,
    timestamp: msg.date,
    forwardFromName,
    forwardFromId,
    forwardFromUsername,
  };
}
