import { loadOntologyProjection } from "./bridge.js";
import type {
  OntologyNode,
  OntologyNodeKind,
  OntologyProjectionPayload,
  OntologySnapshot,
  OntologyView,
} from "./types.js";
import { t } from "../../i18n/index.js";

const ONTOLOGY_NODE_KINDS: OntologyNodeKind[] = ["goal", "constraint", "location", "project", "bond"];

const ONTOLOGY_KIND_LABELS: Record<OntologyNodeKind, string> = {
  goal: t("ontology.kind.goal"),
  constraint: t("ontology.kind.constraint"),
  location: t("ontology.kind.location"),
  project: t("ontology.kind.project"),
  bond: t("ontology.kind.bond"),
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildNode(kind: OntologyNodeKind, index: number, label: string, sourceMsgId: number | null, raw: Record<string, unknown>): OntologyNode {
  return {
    id: `${kind}:${index}`,
    kind,
    label,
    source: {
      msgId: sourceMsgId,
      raw,
    },
    summary: label,
  };
}

function appendContextItems<T extends Record<string, unknown>>(
  nodes: OntologyNode[],
  kind: OntologyNodeKind,
  items: T[] | undefined,
  resolveLabel: (item: T, index: number) => string,
): void {
  if (!items || items.length === 0) {
    return;
  }

  for (const [index, item] of items.entries()) {
    const raw = toRecord(item);
    const label = resolveLabel(item, index);
    const sourceMsgId = typeof item.source_msg_id === "number" ? item.source_msg_id : null;
    nodes.push(buildNode(kind, nodes.length, label, sourceMsgId, raw));
  }
}

export function buildOntologyNodes(payload: OntologyProjectionPayload): OntologyNode[] {
  const nodes: OntologyNode[] = [];
  const context = payload.ontology_context;

  appendContextItems(nodes, "goal", context?.goals, (item, index) => {
    const label = normalizeLabel(item.label, `${ONTOLOGY_KIND_LABELS.goal} ${index + 1}`);
    return label;
  });

  appendContextItems(nodes, "constraint", context?.constraints, (item, index) => {
    const label = normalizeLabel(item.label, `${ONTOLOGY_KIND_LABELS.constraint} ${index + 1}`);
    return label;
  });

  appendContextItems(nodes, "location", context?.locations, (item, index) => {
    const label = normalizeLabel(item.label, `${ONTOLOGY_KIND_LABELS.location} ${index + 1}`);
    const signalType = typeof item.signal_type === "string" && item.signal_type.trim().length > 0
      ? ` (${item.signal_type.trim()})`
      : "";
    return `${label}${signalType}`;
  });

  appendContextItems(nodes, "project", context?.projects, (item, index) => {
    const label = normalizeLabel(item.label, `${ONTOLOGY_KIND_LABELS.project} ${index + 1}`);
    return label;
  });

  appendContextItems(nodes, "bond", context?.bond_components, (item, index) => {
    const component = normalizeLabel(item.component, `${ONTOLOGY_KIND_LABELS.bond} ${index + 1}`);
    return component;
  });

  return nodes;
}

export function buildOntologySnapshot(payload: OntologyProjectionPayload, nodes: OntologyNode[]): OntologySnapshot {
  const counts: Record<OntologyNodeKind, number> = {
    goal: 0,
    constraint: 0,
    location: 0,
    project: 0,
    bond: 0,
  };

  for (const node of nodes) {
    counts[node.kind] += 1;
  }

  return {
    chat: payload.chat_name ? `${payload.chat_name} (${payload.chat_id})` : String(payload.chat_id),
    chatId: payload.chat_id,
    chatName: payload.chat_name ?? String(payload.chat_id),
    sessionId: payload.session_id,
    messageCount: payload.session_meta?.message_count ?? 0,
    segmentCount: payload.session_meta?.segment_count ?? 0,
    factCount: payload.facts?.length ?? 0,
    generatedAt: payload.session_meta?.last_built_at ?? new Date().toISOString(),
    counts,
    nodes,
  };
}

export function buildOntologyView(payload: OntologyProjectionPayload, query: string): OntologyView {
  const nodes = buildOntologyNodes(payload);
  const snapshot = buildOntologySnapshot(payload, nodes);

  return {
    snapshot,
    query,
    filteredNodes: nodes,
  };
}

export async function loadOntologyView(chatId: number, question: string = "Ontology snapshot"): Promise<OntologyView> {
  const payload = await loadOntologyProjection(chatId, question);
  return buildOntologyView(payload, question);
}

export function getOntologyNodeKindLabel(kind: OntologyNodeKind): string {
  return ONTOLOGY_KIND_LABELS[kind];
}

export function listOntologyKinds(): OntologyNodeKind[] {
  return [...ONTOLOGY_NODE_KINDS];
}
