export interface AssistantCompletionMetadata {
  agent?: string;
  providerID?: string;
  modelID?: string;
  logicalMessageId?: string;
  completedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
}
