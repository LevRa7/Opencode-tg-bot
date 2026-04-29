import type { MessageEntity } from "grammy/types";
import { compareTelegramEntities } from "./entity-order.js";
import type { InlineNode } from "./types.js";
import { validateTelegramEntities } from "./validator.js";

const MARKDOWN_V2_TEXT_RESERVED_CHARS = /([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;
const MARKDOWN_V2_CODE_RESERVED_CHARS = /([`\\])/g;
const MARKDOWN_V2_URL_RESERVED_CHARS = /([)\\])/g;

export interface InlineRenderResult {
  text: string;
  entities: MessageEntity[];
}

interface InlineRenderState {
  text: string;
  entities: MessageEntity[];
}

function escapeTelegramMarkdownV2Code(text: string): string {
  return text.replace(MARKDOWN_V2_CODE_RESERVED_CHARS, "\\$1");
}

function escapeTelegramMarkdownV2Url(url: string): string {
  return url.replace(MARKDOWN_V2_URL_RESERVED_CHARS, "\\$1");
}

function renderWrappedMarkdownV2(
  opening: string,
  closing: string,
  children: InlineNode[],
): string {
  const renderedChildren = renderInlineNodesAsTelegramMarkdownV2(children);
  if (!renderedChildren) {
    return "";
  }

  return `${opening}${renderedChildren}${closing}`;
}

function canRenderMarkdownV2Link(nodes: InlineNode[]): boolean {
  return nodes.every((node) => node.type === "text");
}

function renderMarkdownV2LinkFallback(nodes: InlineNode[], url: string): string {
  return escapeTelegramMarkdownV2Text(`${extractInlinePlainText(nodes)}(${url})`);
}

function renderInlineNodeAsTelegramMarkdownV2(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return escapeTelegramMarkdownV2Text(node.text);
    case "bold":
      return renderWrappedMarkdownV2("*", "*", node.children);
    case "italic":
      return renderWrappedMarkdownV2("_", "_", node.children);
    case "strike":
      return renderWrappedMarkdownV2("~", "~", node.children);
    case "underline":
      return renderWrappedMarkdownV2("__", "__", node.children);
    case "spoiler":
      return renderWrappedMarkdownV2("||", "||", node.children);
    case "code":
      if (node.text.includes("\n")) {
        return escapeTelegramMarkdownV2Text(node.text);
      }

      return `\`${escapeTelegramMarkdownV2Code(node.text)}\``;
    case "link": {
      if (!node.url || /\s/.test(node.url) || !canRenderMarkdownV2Link(node.text)) {
        return renderMarkdownV2LinkFallback(node.text, node.url);
      }

      const label = extractInlinePlainText(node.text);
      if (!label) {
        return "";
      }

      return `[${escapeTelegramMarkdownV2Text(label)}](${escapeTelegramMarkdownV2Url(node.url)})`;
    }
    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function appendText(state: InlineRenderState, text: string): void {
  if (!text) {
    return;
  }

  state.text += text;
}

function pushEntity(state: InlineRenderState, entity: MessageEntity): void {
  if (entity.length <= 0) {
    return;
  }

  state.entities.push(entity);
}

function renderIntoState(state: InlineRenderState, nodes: InlineNode[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        appendText(state, node.text);
        break;
      case "bold": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "bold", offset, length: state.text.length - offset });
        break;
      }
      case "italic": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "italic", offset, length: state.text.length - offset });
        break;
      }
      case "strike": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, {
          type: "strikethrough",
          offset,
          length: state.text.length - offset,
        });
        break;
      }
      case "underline": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "underline", offset, length: state.text.length - offset });
        break;
      }
      case "spoiler": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "spoiler", offset, length: state.text.length - offset });
        break;
      }
      case "code": {
        const offset = state.text.length;
        appendText(state, node.text);
        pushEntity(state, { type: "code", offset, length: state.text.length - offset });
        break;
      }
      case "link": {
        const offset = state.text.length;
        renderIntoState(state, node.text);
        pushEntity(state, {
          type: "text_link",
          offset,
          length: state.text.length - offset,
          url: node.url,
        });
        break;
      }
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }
}

export function escapeTelegramMarkdownV2Text(text: string): string {
  return text.replace(MARKDOWN_V2_TEXT_RESERVED_CHARS, "\\$1");
}

export function extractInlinePlainText(nodes: InlineNode[]): string {
  let result = "";

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        result += node.text;
        break;
      case "bold":
      case "italic":
      case "strike":
      case "underline":
      case "spoiler":
        result += extractInlinePlainText(node.children);
        break;
      case "code":
        result += node.text;
        break;
      case "link":
        result += extractInlinePlainText(node.text);
        break;
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return result;
}

export function renderInlineNodesAsTelegramMarkdownV2(nodes: InlineNode[]): string {
  return nodes.map((node) => renderInlineNodeAsTelegramMarkdownV2(node)).join("");
}

export function renderInlineNodes(nodes: InlineNode[]): InlineRenderResult {
  const state: InlineRenderState = {
    text: "",
    entities: [],
  };

  renderIntoState(state, nodes);
  state.entities.sort(compareTelegramEntities);

  return {
    text: state.text,
    entities: state.entities,
  };
}

export function renderInlineNodesValidated(nodes: InlineNode[]): InlineRenderResult {
  const rendered = renderInlineNodes(nodes);
  const validation = validateTelegramEntities(rendered.text, rendered.entities);

  if (!validation.ok) {
    const summary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid Telegram inline entities: ${summary}`);
  }

  return rendered;
}
