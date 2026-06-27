import { sanitizeHtmlForTelegram } from "./html-sanitize.js";
import { TELEGRAM_RICH_MAX_LENGTH } from "../../telegram/constants.js";

const DEFAULT_TELEGRAM_HTML_LIMIT = TELEGRAM_RICH_MAX_LENGTH;
const TAG_REGEX = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
const VOID_TAGS = new Set(["br"]);

interface HtmlTextToken {
  type: "text";
  value: string;
}

interface HtmlOpenToken {
  type: "open";
  name: string;
  raw: string;
  closeRaw: string;
}

interface HtmlCloseToken {
  type: "close";
  name: string;
  raw: string;
}

interface HtmlVoidToken {
  type: "void";
  raw: string;
}

type HtmlToken = HtmlTextToken | HtmlOpenToken | HtmlCloseToken | HtmlVoidToken;

interface StackEntry {
  raw: string;
  closeRaw: string;
}

function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(html)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: html.slice(lastIndex, match.index) });
    }

    const slash = match[1];
    const name = match[2].toLowerCase();
    const attrs = match[3] ?? "";
    const raw = slash ? `</${name}>` : `<${name}${attrs}>`;

    if (slash) {
      tokens.push({ type: "close", name, raw });
    } else if (VOID_TAGS.has(name)) {
      tokens.push({ type: "void", raw });
    } else {
      tokens.push({ type: "open", name, raw, closeRaw: `</${name}>` });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < html.length) {
    tokens.push({ type: "text", value: html.slice(lastIndex) });
  }

  return tokens;
}

function getOpenPrefix(stack: StackEntry[]): string {
  return stack.map((entry) => entry.raw).join("");
}

function getClosingSuffix(stack: StackEntry[]): string {
  return [...stack]
    .reverse()
    .map((entry) => entry.closeRaw)
    .join("");
}

function isHighSurrogate(charCode: number): boolean {
  return charCode >= 0xd800 && charCode <= 0xdbff;
}

function isLowSurrogate(charCode: number): boolean {
  return charCode >= 0xdc00 && charCode <= 0xdfff;
}

function adjustTextBoundary(text: string, index: number): number {
  let adjusted = Math.max(0, Math.min(index, text.length));

  if (adjusted < text.length && isLowSurrogate(text.charCodeAt(adjusted))) {
    adjusted -= 1;
  }

  if (adjusted > 0 && adjusted < text.length && isHighSurrogate(text.charCodeAt(adjusted - 1))) {
    adjusted -= 1;
  }

  const danglingEntityStart = text.lastIndexOf("&", adjusted - 1);
  if (danglingEntityStart >= 0) {
    const danglingEntityEnd = text.indexOf(";", danglingEntityStart);
    if (danglingEntityEnd === -1 || danglingEntityEnd >= adjusted) {
      adjusted = danglingEntityStart;
    }
  }

  return Math.max(0, adjusted);
}

function chooseTextSlice(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  let splitIndex = text.lastIndexOf("\n", maxLength);
  if (splitIndex <= 0 || splitIndex < Math.floor(maxLength * 0.5)) {
    splitIndex = text.lastIndexOf(" ", maxLength);
  }
  if (splitIndex <= 0 || splitIndex < Math.floor(maxLength * 0.5)) {
    splitIndex = maxLength;
  }

  const adjustedBoundary = adjustTextBoundary(text, splitIndex);
  if (adjustedBoundary <= 0) {
    throw new Error("maxLength would split an HTML entity at a chunk boundary");
  }

  return text.slice(0, adjustedBoundary);
}

function pushChunk(chunks: string[], buffer: string, stack: StackEntry[]): void {
  const chunk = `${buffer}${getClosingSuffix(stack)}`;
  if (chunk) {
    chunks.push(chunk);
  }
}

export function chunkTelegramHtml(html: string, maxLength = DEFAULT_TELEGRAM_HTML_LIMIT): string[] {
  const normalized = sanitizeHtmlForTelegram(html.trim());
  if (!normalized) {
    return [];
  }

  if (maxLength <= 0) {
    throw new Error("maxLength must be greater than zero");
  }

  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const tokens = tokenizeHtml(normalized);
  const chunks: string[] = [];
  const stack: StackEntry[] = [];
  let buffer = "";

  const resetBuffer = () => {
    buffer = getOpenPrefix(stack);
  };

  const flushChunk = () => {
    pushChunk(chunks, buffer, stack);
    resetBuffer();
  };

  const flushOrThrowForWrapperOverhead = () => {
    const openPrefix = getOpenPrefix(stack);
    if (buffer.length > openPrefix.length) {
      flushChunk();
      return;
    }

    throw new Error("maxLength is too small for the HTML wrapper overhead");
  };

  for (const token of tokens) {
    if (token.type === "text") {
      let remaining = token.value;

      while (remaining) {
        const available = maxLength - buffer.length - getClosingSuffix(stack).length;
        if (available <= 0) {
          flushOrThrowForWrapperOverhead();
          continue;
        }

        const nextPart = chooseTextSlice(remaining, available);
        buffer += nextPart;
        remaining = remaining.slice(nextPart.length);

        if (remaining) {
          flushChunk();
        }
      }

      continue;
    }

    if (token.type === "void") {
      if (buffer.length + token.raw.length + getClosingSuffix(stack).length > maxLength) {
        flushOrThrowForWrapperOverhead();
      }
      buffer += token.raw;
      continue;
    }

    if (token.type === "open") {
      if (token.raw.length + token.closeRaw.length > maxLength) {
        throw new Error("maxLength is too small for the HTML wrapper overhead");
      }

      if (buffer.length + token.raw.length + getClosingSuffix(stack).length + token.closeRaw.length > maxLength) {
        flushOrThrowForWrapperOverhead();
      }
      buffer += token.raw;
      stack.push({ raw: token.raw, closeRaw: token.closeRaw });
      continue;
    }

    const nextStack = stack.slice(0, -1);
    if (buffer.length + token.raw.length + getClosingSuffix(nextStack).length > maxLength) {
      flushOrThrowForWrapperOverhead();
    }
    buffer += token.raw;
    stack.pop();
  }

  pushChunk(chunks, buffer, stack);
  return chunks.filter(Boolean);
}

export function getFirstTelegramHtmlChunk(html: string, maxLength = DEFAULT_TELEGRAM_HTML_LIMIT): string {
  return chunkTelegramHtml(html, maxLength)[0] ?? "";
}
