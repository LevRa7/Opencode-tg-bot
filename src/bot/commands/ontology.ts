import { CommandContext, Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionMetadata } from "../../interaction/types.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { appendInlineMenuCancelButton, ensureActiveInlineMenu, replyWithInlineMenu } from "../handlers/inline-menu.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { loadOntologyView } from "../ontology/service.js";
import { formatOntologyGraphText, formatOntologyNodeText, formatOntologySummaryText } from "../ontology/render.js";
import type { OntologyView } from "../ontology/types.js";

const ONTOLOGY_PAGE_SIZE = 6;
const ONTOLOGY_CALLBACK_PREFIX = "ontology:";
const ONTOLOGY_VIEW_CALLBACK = `${ONTOLOGY_CALLBACK_PREFIX}view`;
const ONTOLOGY_REFRESH_CALLBACK = `${ONTOLOGY_CALLBACK_PREFIX}refresh`;
const ONTOLOGY_BACK_CALLBACK = `${ONTOLOGY_CALLBACK_PREFIX}back`;
const ONTOLOGY_GRAPH_PAGE_PREFIX = `${ONTOLOGY_CALLBACK_PREFIX}page:`;
const ONTOLOGY_NODE_PREFIX = `${ONTOLOGY_CALLBACK_PREFIX}node:`;

interface OntologyMenuMetadata {
  menuKind: "ontology";
  messageId: number;
  chatId: number;
  question: string;
  view: "summary" | "graph" | "node";
  page: number;
  selectedIndex?: number;
}

type OntologyMenuState = {
  metadata: OntologyMenuMetadata;
};

function buildOntologyState(view: OntologyMenuState["metadata"]): OntologyMenuMetadata {
  return view;
}

function toOntologyInteractionMetadata(view: OntologyMenuMetadata): InteractionMetadata {
  return {
    menuKind: view.menuKind,
    messageId: view.messageId,
    chatId: view.chatId,
    question: view.question,
    view: view.view,
    page: view.page,
    selectedIndex: view.selectedIndex,
  };
}

function getOntologyMenuState(): OntologyMenuMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "inline") {
    return null;
  }

  const metadata = state.metadata as Partial<OntologyMenuMetadata>;
  if (
    metadata.menuKind !== "ontology" ||
    typeof metadata.messageId !== "number" ||
    typeof metadata.chatId !== "number" ||
    typeof metadata.question !== "string" ||
    (metadata.view !== "summary" && metadata.view !== "graph" && metadata.view !== "node") ||
    typeof metadata.page !== "number"
  ) {
    return null;
  }

  return {
    menuKind: "ontology",
    messageId: metadata.messageId,
    chatId: metadata.chatId,
    question: metadata.question,
    view: metadata.view,
    page: metadata.page,
    selectedIndex: typeof metadata.selectedIndex === "number" ? metadata.selectedIndex : undefined,
  };
}

function transitionOntologyState(metadata: OntologyMenuMetadata): void {
  interactionManager.transition({ metadata: toOntologyInteractionMetadata(metadata) });
}

function buildSummaryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("ontology.button.view_graph"), ONTOLOGY_VIEW_CALLBACK)
    .text(t("ontology.button.refresh"), ONTOLOGY_REFRESH_CALLBACK);
}

function buildGraphKeyboard(view: OntologyView, page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageSize = ONTOLOGY_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(view.filteredNodes.length / pageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, view.filteredNodes.length);

  view.filteredNodes.slice(startIndex, endIndex).forEach((node, index) => {
    keyboard.text(`${startIndex + index + 1}. ${node.label}`, `${ONTOLOGY_NODE_PREFIX}${startIndex + index}`).row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(t("ontology.button.prev_page"), `${ONTOLOGY_GRAPH_PAGE_PREFIX}${normalizedPage - 1}`);
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(t("ontology.button.next_page"), `${ONTOLOGY_GRAPH_PAGE_PREFIX}${normalizedPage + 1}`);
    }

    keyboard.row();
  }

  keyboard.text(t("ontology.button.back"), ONTOLOGY_BACK_CALLBACK).text(t("ontology.button.refresh"), ONTOLOGY_REFRESH_CALLBACK);
  return keyboard;
}

function buildNodeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("ontology.button.back"), ONTOLOGY_BACK_CALLBACK)
    .text(t("ontology.button.summary"), ONTOLOGY_VIEW_CALLBACK)
    .row()
    .text(t("ontology.button.refresh"), ONTOLOGY_REFRESH_CALLBACK);
}

async function renderOntologySummary(ctx: Context, view: OntologyView): Promise<void> {
  const keyboard = buildSummaryKeyboard();
  const messageId = await replyWithInlineMenu(ctx, {
    menuKind: "ontology",
    text: formatOntologySummaryText(view),
    keyboard,
  });

  transitionOntologyState(buildOntologyState({
    menuKind: "ontology",
    messageId,
    chatId: view.snapshot.chatId,
    question: view.query,
    view: "summary",
    page: 0,
  }));
}

async function loadCurrentOntologyView(state: OntologyMenuMetadata): Promise<OntologyView> {
  return loadOntologyView(state.chatId, state.question);
}

async function editOntologyMessage(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<boolean> {
  try {
    await ctx.editMessageText(text, { reply_markup: appendInlineMenuCancelButton(keyboard, "ontology") });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("message is not modified")) {
      return true;
    }

    throw error;
  }
}

function parseOntologyPageCallback(data: string): number | null {
  if (!data.startsWith(ONTOLOGY_GRAPH_PAGE_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(ONTOLOGY_GRAPH_PAGE_PREFIX.length);
  const page = Number(rawPage);
  return Number.isInteger(page) && page >= 0 ? page : null;
}

function parseOntologyNodeCallback(data: string): number | null {
  if (!data.startsWith(ONTOLOGY_NODE_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(ONTOLOGY_NODE_PREFIX.length);
  const index = Number(rawIndex);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function isOntologyCallback(data: string): boolean {
  return (
    data === ONTOLOGY_VIEW_CALLBACK ||
    data === ONTOLOGY_REFRESH_CALLBACK ||
    data === ONTOLOGY_BACK_CALLBACK ||
    data.startsWith(ONTOLOGY_GRAPH_PAGE_PREFIX) ||
    data.startsWith(ONTOLOGY_NODE_PREFIX)
  );
}

export async function ontologyCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    if (!ctx.chat) {
      await ctx.reply(t("error.generic"));
      return;
    }

    const view = await loadOntologyView(ctx.chat.id);
    await renderOntologySummary(ctx, view);
  } catch (error) {
    logger.error("[Ontology] Failed to load ontology view:", error);
    await ctx.reply(t("ontology.load_error"));
  }
}

async function renderGraphView(ctx: Context, state: OntologyMenuMetadata, page: number): Promise<boolean> {
  const view = await loadCurrentOntologyView(state);
  const keyboard = buildGraphKeyboard(view, page);
  const totalPages = Math.max(1, Math.ceil(view.filteredNodes.length / ONTOLOGY_PAGE_SIZE));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);

  await editOntologyMessage(ctx, formatOntologyGraphText(view, normalizedPage, ONTOLOGY_PAGE_SIZE), keyboard);
  transitionOntologyState({ ...state, view: "graph", page: normalizedPage, selectedIndex: undefined });
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}

async function renderNodeView(ctx: Context, state: OntologyMenuMetadata, index: number): Promise<boolean> {
  const view = await loadCurrentOntologyView(state);
  const node = view.filteredNodes[index];
  if (!node) {
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }

  const page = Math.floor(index / ONTOLOGY_PAGE_SIZE);
  const keyboard = buildNodeKeyboard();
  await editOntologyMessage(ctx, formatOntologyNodeText(view, index), keyboard);
  transitionOntologyState({ ...state, view: "node", page, selectedIndex: index });
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}

async function renderSummaryView(ctx: Context, state: OntologyMenuMetadata): Promise<boolean> {
  const view = await loadCurrentOntologyView(state);
  const keyboard = buildSummaryKeyboard();
  await editOntologyMessage(ctx, formatOntologySummaryText(view), keyboard);
  transitionOntologyState({ ...state, view: "summary", page: 0, selectedIndex: undefined });
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}

async function renderBackView(ctx: Context, state: OntologyMenuMetadata): Promise<boolean> {
  if (state.view === "node") {
    return renderGraphView(ctx, state, state.page);
  }

  return renderSummaryView(ctx, state);
}

export async function handleOntologyCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !isOntologyCallback(data)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "ontology");
  if (!isActiveMenu) {
    return true;
  }

  const state = getOntologyMenuState();
  if (!state) {
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }

  try {
    const page = parseOntologyPageCallback(data);
    if (page !== null) {
      return renderGraphView(ctx, state, page);
    }

    const nodeIndex = parseOntologyNodeCallback(data);
    if (nodeIndex !== null) {
      return renderNodeView(ctx, state, nodeIndex);
    }

    if (data === ONTOLOGY_VIEW_CALLBACK) {
      return renderSummaryView(ctx, state);
    }

    if (data === ONTOLOGY_REFRESH_CALLBACK) {
      if (state.view === "graph") {
        return renderGraphView(ctx, state, state.page);
      }

      if (state.view === "node" && typeof state.selectedIndex === "number") {
        return renderNodeView(ctx, state, state.selectedIndex);
      }

      return renderSummaryView(ctx, state);
    }

    if (data === ONTOLOGY_BACK_CALLBACK) {
      return renderBackView(ctx, state);
    }

    return false;
  } catch (error) {
    logger.error("[Ontology] Failed to handle ontology callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
