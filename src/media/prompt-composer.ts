import {
  createForwardedSourceTag,
  formatMetadataLine,
  type ComposedPromptResult,
  type CorrelatedIncomingItem,
  type DeferredItemKind,
  type ResolvedDeferredItem,
  type TranslateFn,
} from "./batch-types.js";

type DeferredPromptItem = CorrelatedIncomingItem | ResolvedDeferredItem;

function normalizeText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveForwardedTag(item: DeferredPromptItem, t: TranslateFn): string | undefined {
  const existingTag = "forwardedTag" in item ? normalizeText(item.forwardedTag) : undefined;
  if (existingTag) {
    return existingTag;
  }

  if (item.forwardedSource) {
    return createForwardedSourceTag(item.forwardedSource, t);
  }

  const metadata = "metadata" in item ? item.metadata : undefined;
  const forwardedDisplay = metadata?.forwardFromName?.trim() || metadata?.forwardFromUsername?.trim();
  if (forwardedDisplay) {
    return createForwardedSourceTag({ displayName: forwardedDisplay }, t);
  }

  if (metadata?.forwardFromId) {
    return createForwardedSourceTag({ isFromAnotherUser: true }, t);
  }

  return undefined;
}

function isForwardedTextItem(item: DeferredPromptItem, t: TranslateFn): boolean {
  return item.kind === "text" && resolveForwardedTag(item, t) !== undefined;
}

function getLatestDirectTextItem(items: DeferredPromptItem[], t: TranslateFn): DeferredPromptItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind !== "text" || isForwardedTextItem(item, t)) {
      continue;
    }

    if (normalizeText(item.directText)) {
      return item;
    }
  }

  return undefined;
}

function getLatestAudioMainItem(items: DeferredPromptItem[]): DeferredPromptItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "audio" && normalizeText(item.contextText)) {
      return item;
    }
  }

  return undefined;
}

function getKindLabel(kind: DeferredItemKind, t: TranslateFn): string {
  switch (kind) {
    case "photo":
      return t("deferred.kind.photo");
    case "document":
      return t("deferred.kind.document");
    case "audio":
      return t("deferred.kind.audio");
    case "video":
      return t("deferred.kind.video");
    case "text":
      return t("deferred.kind.text");
  }
}

function buildMetadataPrefix(item: DeferredPromptItem): string {
  const meta = "metadata" in item ? item.metadata : undefined;
  if (!meta) return "";
  return formatMetadataLine(meta, "");
}

function buildPreviewLine(item: DeferredPromptItem, t: TranslateFn): string | undefined {
  const preview =
    normalizeText(item.previewText) ??
    normalizeText(item.directText) ??
    normalizeText(item.contextText) ??
    normalizeText(item.caption);

  if (!preview) {
    return undefined;
  }

  const metadataPrefix = buildMetadataPrefix(item);
  const forwardedTag = resolveForwardedTag(item, t);
  const prefixParts = [metadataPrefix, forwardedTag].filter(Boolean);
  if (forwardedTag) {
    if (item.kind !== "text") {
      return `${prefixParts.join(" ")} ${getKindLabel(item.kind, t)}: ${preview}`;
    }

    return `${prefixParts.join(" ")} ${preview}`;
  }

  return prefixParts.length > 0 ? `${prefixParts.join(" ")} ${preview}` : preview;
}

function buildContextBlock(item: DeferredPromptItem, t: TranslateFn): string | undefined {
  const body =
    normalizeText(item.contextText) ??
    normalizeText(item.directText) ??
    normalizeText(item.caption) ??
    normalizeText(item.previewText);

  if (!body) {
    return undefined;
  }

  const metadataPrefix = buildMetadataPrefix(item);
  const forwardedTag = resolveForwardedTag(item, t);
  const headerParts = [metadataPrefix, forwardedTag].filter(Boolean);
  if (forwardedTag) {
    if (item.kind !== "text") {
      return `${headerParts.join("\n")}\n[${getKindLabel(item.kind, t)}]\n${body}`;
    }

    return `${headerParts.join("\n")}\n${body}`;
  }

  if (item.kind === "text") {
    return headerParts.length > 0 ? `${headerParts.join("\n")}\n${body}` : body;
  }

  return `${headerParts.length > 0 ? `${headerParts.join("\n")}\n` : ""}[${getKindLabel(item.kind, t)}]\n${body}`;
}

function buildPreviewText(items: DeferredPromptItem[], t: TranslateFn): string | undefined {
  const previewLines = items
    .map((item) => buildPreviewLine(item, t))
    .filter((line): line is string => line !== undefined);

  if (previewLines.length === 0) {
    return undefined;
  }

  const label =
    previewLines.length === 1
      ? t("deferred.preview.label_one")
      : t("deferred.preview.label_other");

  return `${t("deferred.preview.header", { count: previewLines.length, label })}${previewLines
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n")}`;
}

function buildPrefixedContext(prefix: string, blocks: string[]): string {
  if (blocks.length === 0) {
    return prefix;
  }

  return `${prefix}\n\n${blocks.join("\n\n")}`;
}

export function composeDeferredMediaPrompt(
  items: Array<CorrelatedIncomingItem | ResolvedDeferredItem>,
  t: TranslateFn,
): ComposedPromptResult {
  const directTextItem = getLatestDirectTextItem(items, t);
  const audioMainItem = directTextItem ? undefined : getLatestAudioMainItem(items);

  const previewItems = items.filter((item) => item !== directTextItem);
  const previewText = buildPreviewText(previewItems, t);

  if (directTextItem) {
    const directText = normalizeText(directTextItem.directText);
    const directTextWithMeta = directText
      ? [buildMetadataPrefix(directTextItem), directText].filter(Boolean).join("\n")
      : directText;
    const contextBlocks = items
      .filter((item) => item !== directTextItem)
      .map((item) => buildContextBlock(item, t))
      .filter((block): block is string => block !== undefined);

    return {
      directText: directTextWithMeta,
      previewText,
      contextText: buildPrefixedContext(
        "Additional context for the user's previous request:",
        contextBlocks,
      ),
    };
  }

  if (audioMainItem) {
    const directText = normalizeText(audioMainItem.contextText);
    const contextBlocks = items
      .filter((item) => item !== audioMainItem)
      .map((item) => buildContextBlock(item, t))
      .filter((block): block is string => block !== undefined);

    return {
      directText,
      previewText,
      contextText: buildPrefixedContext(
        `User request from transcribed audio:\n${directText}`,
        contextBlocks,
      ),
    };
  }

  const contextBlocks = items
    .map((item) => buildContextBlock(item, t))
    .filter((block): block is string => block !== undefined);

  return {
    previewText,
    contextText: buildPrefixedContext("Analyze the extracted context below.", contextBlocks),
  };
}
