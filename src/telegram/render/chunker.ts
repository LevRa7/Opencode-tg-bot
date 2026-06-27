import type { MessageEntity } from "grammy/types";
import type { TelegramRenderedBlock, TelegramRenderedPart } from "./types.js";
import { logger } from "../../utils/logger.js";
import { TELEGRAM_PLAIN_MAX_LENGTH, TELEGRAM_RICH_MAX_LENGTH } from "../constants.js";
import { sortTelegramEntities } from "./entity-order.js";
import { validateTelegramEntities } from "./validator.js";

const DEFAULT_MAX_PART_LENGTH = TELEGRAM_PLAIN_MAX_LENGTH;
const DEFAULT_BLOCK_SEPARATOR = "\n\n";

export interface TelegramChunkerOptions {
  maxPartLength?: number;
  blockSeparator?: string;
}

interface TelegramRenderedPartBuilder {
  text: string;
  fallbackText: string;
  entities: MessageEntity[];
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isSafeUtf16Boundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) {
    return true;
  }

  return !(isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index)));
}

function isEntityBoundary(entities: MessageEntity[] | undefined, index: number): boolean {
  if (!entities?.length) {
    return true;
  }

  return !entities.some((entity) => entity.offset < index && index < entity.offset + entity.length);
}

function normalizeOptions(options?: TelegramChunkerOptions): Required<TelegramChunkerOptions> {
  return {
    maxPartLength: Math.max(2, Math.floor(options?.maxPartLength ?? DEFAULT_MAX_PART_LENGTH)),
    blockSeparator: options?.blockSeparator ?? DEFAULT_BLOCK_SEPARATOR,
  };
}

function createRenderedPart(
  text: string,
  fallbackText: string,
  entities?: MessageEntity[],
): TelegramRenderedPart {
  const normalizedEntities = entities?.length ? sortTelegramEntities(entities) : undefined;
  if (normalizedEntities) {
    const validation = validateTelegramEntities(text, normalizedEntities);
    if (!validation.ok) {
      throw new Error(validation.issues.map((issue) => issue.message).join("; "));
    }
  }

  return {
    text,
    entities: normalizedEntities,
    fallbackText,
    source: normalizedEntities?.length ? "entities" : "plain",
  };
}

function clonePart(part: TelegramRenderedPart): TelegramRenderedPart {
  return {
    text: part.text,
    entities: part.entities ? [...part.entities] : undefined,
    fallbackText: part.fallbackText,
    source: part.source,
  };
}

function isWhitespaceBoundary(text: string, index: number): boolean {
  return index > 0 && /\s/.test(text[index - 1]);
}

function findSplitBoundary(
  text: string,
  start: number,
  maxLength: number,
  entities?: MessageEntity[],
): number | null {
  const hardEnd = Math.min(text.length, start + maxLength);
  if (hardEnd >= text.length) {
    return text.length;
  }

  let whitespaceBoundary: number | null = null;
  let fallbackBoundary: number | null = null;

  for (let index = hardEnd; index > start; index--) {
    if (!isSafeUtf16Boundary(text, index) || !isEntityBoundary(entities, index)) {
      continue;
    }

    if (text[index - 1] === "\n") {
      return index;
    }

    if (whitespaceBoundary === null && isWhitespaceBoundary(text, index)) {
      whitespaceBoundary = index;
    }

    if (fallbackBoundary === null) {
      fallbackBoundary = index;
    }
  }

  return whitespaceBoundary ?? fallbackBoundary;
}

function rebaseSliceEntities(
  entities: MessageEntity[] | undefined,
  start: number,
  end: number,
): MessageEntity[] {
  if (!entities?.length) {
    return [];
  }

  return entities
    .filter((entity) => entity.offset >= start && entity.offset + entity.length <= end)
    .map((entity) => ({
      ...entity,
      offset: entity.offset - start,
    }));
}

function splitPlainText(text: string, maxLength: number): string[] {
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = findSplitBoundary(text, start, maxLength);
    if (!end || end <= start) {
      throw new Error("Unable to split plain text on a safe UTF-16 boundary");
    }

    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

function isFullRangePreEntity(block: TelegramRenderedBlock): MessageEntity | null {
  if (block.entities?.length !== 1) {
    return null;
  }

  const [entity] = block.entities;
  if (entity.type !== "pre" || entity.offset !== 0 || entity.length !== block.text.length) {
    return null;
  }

  return entity;
}

function splitPreformattedBlock(
  block: TelegramRenderedBlock,
  maxLength: number,
  preEntity: Extract<MessageEntity, { type: "pre" }>,
): TelegramRenderedPart[] {
  const parts: TelegramRenderedPart[] = [];
  let start = 0;

  while (start < block.text.length) {
    const end = findSplitBoundary(block.text, start, maxLength);
    if (!end || end <= start) {
      throw new Error(`Unable to split preformatted ${block.blockType} block`);
    }

    const text = block.text.slice(start, end);
    parts.push(
      createRenderedPart(text, text, [
        {
          type: "pre",
          offset: 0,
          length: text.length,
          ...(preEntity.language ? { language: preEntity.language } : {}),
        },
      ]),
    );
    start = end;
  }

  logger.debug("[TelegramRender] Preformatted block chunked", {
    blockType: block.blockType,
    textLength: block.text.length,
    maxLength,
    partCount: parts.length,
  });

  return parts;
}

function splitRichBlock(
  block: TelegramRenderedBlock,
  maxLength: number,
): TelegramRenderedPart[] | null {
  if (!block.entities?.length) {
    return null;
  }

  const parts: TelegramRenderedPart[] = [];
  let start = 0;

  while (start < block.text.length) {
    const end = findSplitBoundary(block.text, start, maxLength, block.entities);
    if (!end || end <= start) {
      return null;
    }

    const entities = rebaseSliceEntities(block.entities, start, end);
    const text = block.text.slice(start, end);
    parts.push(createRenderedPart(text, text, entities));
    start = end;
  }

  if (parts.length > 1) {
    logger.debug("[TelegramRender] Rich block chunked", {
      blockType: block.blockType,
      textLength: block.text.length,
      entityCount: block.entities.length,
      maxLength,
      partCount: parts.length,
    });
  }

  return parts;
}

function splitBlockToParts(
  block: TelegramRenderedBlock,
  maxLength: number,
): TelegramRenderedPart[] {
  if (!block.text) {
    return [];
  }

  // When maxLength is explicitly set below the standard plain limit (e.g. in tests),
  // respect it for all blocks. Otherwise, rich blocks can use the higher Telegram limit.
  const isTightLimit = maxLength < TELEGRAM_PLAIN_MAX_LENGTH;
  const effectiveMaxLength =
    !isTightLimit && block.entities?.length ? TELEGRAM_RICH_MAX_LENGTH : maxLength;

  if (block.text.length <= effectiveMaxLength) {
    return [createRenderedPart(block.text, block.fallbackText, block.entities)];
  }

  const preEntity = isFullRangePreEntity(block);
  if (preEntity) {
    return splitPreformattedBlock(
      block,
      effectiveMaxLength,
      preEntity as Extract<MessageEntity, { type: "pre" }>,
    );
  }

  if (block.entities?.length) {
    const richParts = splitRichBlock(block, effectiveMaxLength);
    if (richParts) {
      return richParts;
    }

    logger.debug("[TelegramRender] Rich block downgraded to plain during chunking", {
      blockType: block.blockType,
      textLength: block.text.length,
      entityCount: block.entities.length,
      maxLength,
    });
  }

  // Downgraded to plain — use the standard plain limit
  return splitPlainText(block.fallbackText, maxLength).map((text) =>
    createRenderedPart(text, text),
  );
}

function createBuilder(): TelegramRenderedPartBuilder {
  return {
    text: "",
    fallbackText: "",
    entities: [],
  };
}

function appendToBuilder(
  builder: TelegramRenderedPartBuilder,
  chunk: TelegramRenderedPart,
  prefix: string,
): void {
  const offset = builder.text.length + prefix.length;

  builder.text += `${prefix}${chunk.text}`;
  builder.fallbackText += `${prefix}${chunk.fallbackText}`;
  if (chunk.entities?.length) {
    builder.entities.push(
      ...chunk.entities.map((entity) => ({
        ...entity,
        offset: entity.offset + offset,
      })),
    );
  }
}

function finalizeBuilder(builder: TelegramRenderedPartBuilder | null): TelegramRenderedPart | null {
  if (!builder || !builder.text) {
    return null;
  }

  return createRenderedPart(builder.text, builder.fallbackText, builder.entities);
}

export function chunkTelegramRenderedBlocks(
  blocks: TelegramRenderedBlock[],
  options?: TelegramChunkerOptions,
): TelegramRenderedPart[] {
  const { maxPartLength, blockSeparator } = normalizeOptions(options);
  // When maxPartLength is explicitly set below the standard plain limit (e.g. in tests),
  // use it directly for all blocks. Otherwise, apply smart limits per builder type.
  const isTightLimit = maxPartLength < TELEGRAM_PLAIN_MAX_LENGTH;
  const blockGroups = blocks
    .map((block) => splitBlockToParts(block, maxPartLength))
    .filter((group) => group.length > 0);
  const parts: TelegramRenderedPart[] = [];
  let current = createBuilder();

  for (const blockParts of blockGroups) {
    for (let index = 0; index < blockParts.length; index++) {
      const chunk = blockParts[index];
      const needsSeparator = index === 0 && current.text.length > 0;
      const prefix = needsSeparator ? blockSeparator : "";
      // Rich builders (with entities) can use the higher Telegram limit,
      // unless an explicit tight limit is set.
      const builderMaxLength =
        !isTightLimit && current.entities.length > 0
          ? TELEGRAM_RICH_MAX_LENGTH
          : maxPartLength;

      if (
        current.text.length > 0 &&
        current.text.length + prefix.length + chunk.text.length > builderMaxLength
      ) {
        const finalized = finalizeBuilder(current);
        if (finalized) {
          parts.push(finalized);
        }
        current = createBuilder();
        appendToBuilder(current, chunk, "");
        continue;
      }

      appendToBuilder(current, chunk, prefix);
    }
  }

  const finalized = finalizeBuilder(current);
  if (finalized) {
    parts.push(finalized);
  }

  return parts.map(clonePart);
}
