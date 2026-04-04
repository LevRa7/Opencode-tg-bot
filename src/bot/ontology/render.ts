import type { OntologyNode, OntologyNodeKind, OntologyView } from "./types.js";
import { t } from "../../i18n/index.js";
import { getOntologyNodeKindLabel } from "./service.js";

const TELEGRAM_TEXT_LIMIT = 3900;
const NODE_PREVIEW_LIMIT = 160;
const RAW_PREVIEW_LIMIT = 700;

const KIND_EMOJI: Record<OntologyNodeKind, string> = {
  goal: "🎯",
  constraint: "⚠️",
  location: "📍",
  project: "🗂️",
  bond: "🔗",
};

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatCounts(view: OntologyView): string[] {
  return [
    t("ontology.summary.goals", { count: view.snapshot.counts.goal }),
    t("ontology.summary.constraints", { count: view.snapshot.counts.constraint }),
    t("ontology.summary.locations", { count: view.snapshot.counts.location }),
    t("ontology.summary.projects", { count: view.snapshot.counts.project }),
    t("ontology.summary.bonds", { count: view.snapshot.counts.bond }),
  ];
}

export function formatOntologySummaryText(view: OntologyView): string {
  const snapshot = view.snapshot;
  const lines = [
    t("ontology.summary.title"),
    "",
    t("ontology.summary.chat", { chat: snapshot.chat }),
    t("ontology.summary.session", { sessionId: snapshot.sessionId }),
    t("ontology.summary.query", { query: view.query }),
    t("ontology.summary.messages", { messageCount: snapshot.messageCount }),
    t("ontology.summary.segments", { segmentCount: snapshot.segmentCount }),
    t("ontology.summary.facts", { factCount: snapshot.factCount }),
    t("ontology.summary.updated", { generatedAt: snapshot.generatedAt }),
    "",
    t("ontology.summary.counts"),
    ...formatCounts(view),
  ];

  return truncate(lines.join("\n"), TELEGRAM_TEXT_LIMIT);
}

function formatNodeHeadline(node: OntologyNode, index: number): string {
  const emoji = KIND_EMOJI[node.kind];
  const label = compactText(node.label);
  return `${index + 1}. ${emoji} ${label}`;
}

function formatNodeSnippet(node: OntologyNode): string {
  return truncate(compactText(node.summary), NODE_PREVIEW_LIMIT);
}

export function formatOntologyGraphText(view: OntologyView, page: number, pageSize: number): string {
  const totalNodes = view.filteredNodes.length;
  const totalPages = Math.max(1, Math.ceil(totalNodes / Math.max(1, pageSize)));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * Math.max(1, pageSize);
  const endIndex = Math.min(startIndex + Math.max(1, pageSize), totalNodes);
  const visibleNodes = view.filteredNodes.slice(startIndex, endIndex);

  const lines = [
    t("ontology.graph.title"),
    t("ontology.graph.page", { current: normalizedPage + 1, total: totalPages }),
    "",
  ];

  if (visibleNodes.length === 0) {
    lines.push(t("ontology.graph.empty"));
    return truncate(lines.join("\n"), TELEGRAM_TEXT_LIMIT);
  }

  visibleNodes.forEach((node, index) => {
    lines.push(formatNodeHeadline(node, startIndex + index));
    lines.push(`  ${formatNodeSnippet(node)}`);
    if (index < visibleNodes.length - 1) {
      lines.push("");
    }
  });

  return truncate(lines.join("\n"), TELEGRAM_TEXT_LIMIT);
}

function formatRawSnippet(raw: Record<string, unknown>): string {
  return truncate(JSON.stringify(raw, null, 2), RAW_PREVIEW_LIMIT);
}

export function formatOntologyNodeText(view: OntologyView, index: number): string {
  const node = view.filteredNodes[index];
  if (!node) {
    return t("ontology.node.empty");
  }

  const lines = [
    t("ontology.node.title"),
    t("ontology.node.index", { index: index + 1 }),
    t("ontology.node.kind", { kind: getOntologyNodeKindLabel(node.kind) }),
    t("ontology.node.label", { label: node.label }),
    t("ontology.node.summary", { summary: node.summary }),
    t("ontology.node.source_message", { msgId: node.source.msgId ?? t("common.unknown") }),
    "",
    t("ontology.node.raw"),
    formatRawSnippet(node.source.raw),
  ];

  return truncate(lines.join("\n"), TELEGRAM_TEXT_LIMIT);
}
