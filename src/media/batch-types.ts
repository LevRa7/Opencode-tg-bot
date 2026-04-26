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
