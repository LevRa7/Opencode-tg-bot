import type { MessageEntity } from "grammy/types";
import { compareTelegramEntities } from "./entity-order.js";
import type { InlineNode } from "./types.js";
import { validateTelegramEntities } from "./validator.js";

export interface InlineRenderResult {
  text: string;
  entities: MessageEntity[];
}

interface InlineRenderState {
  text: string;
  entities: MessageEntity[];
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
