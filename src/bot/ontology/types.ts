export type OntologyNodeKind = "goal" | "constraint" | "location" | "project" | "bond";

export interface OntologyNodeSource {
  msgId: number | null;
  raw: Record<string, unknown>;
}

export interface OntologyNode {
  id: string;
  kind: OntologyNodeKind;
  label: string;
  source: OntologyNodeSource;
  summary: string;
}

export interface OntologyProjectionContext {
  goals?: Array<{ label?: string; source_msg_id?: number }>;
  constraints?: Array<{ label?: string; source_msg_id?: number }>;
  locations?: Array<{ signal_type?: string; label?: string; source_msg_id?: number }>;
  projects?: Array<{ label?: string; source_msg_id?: number }>;
  bond_components?: Array<{ component?: string }>;
}

export interface OntologyProjectionPayload {
  chat_id: number;
  chat_name?: string;
  session_id: string;
  session_meta?: {
    message_count?: number;
    segment_count?: number;
    first_msg_ts?: string;
    last_msg_ts?: string;
    last_built_at?: string;
  };
  facts?: Array<Record<string, unknown>>;
  ontology_context?: OntologyProjectionContext;
}

export interface OntologySnapshot {
  chat: string;
  chatId: number;
  chatName: string;
  sessionId: string;
  messageCount: number;
  segmentCount: number;
  factCount: number;
  generatedAt: string;
  counts: Record<OntologyNodeKind, number>;
  nodes: OntologyNode[];
}

export interface OntologyView {
  snapshot: OntologySnapshot;
  query: string;
  filteredNodes: OntologyNode[];
}
