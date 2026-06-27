/**
 * Token information from AssistantMessage
 */
export interface TokensInfo {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * File change info from OpenCode — enriched with tool context for rich formatting
 */
export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
  /** Tool that produced this change (edit, write, apply_patch, read, bash, etc.) */
  tool?: string;
  /** For read operations: the starting line number (1-indexed) */
  readOffset?: number;
  /** For read operations: the ending line number (inclusive) */
  readLimit?: number;
}

/**
 * State of the pinned status message
 */
export interface PinnedMessageState {
  messageId: number | null;
  chatId: number | null;
  messageThreadId?: number;
  createdInCurrentProcess: boolean;
  sessionId: string | null;
  sessionTitle: string;
  projectName: string;
  tokensUsed: number;
  tokensLimit: number;
  lastUpdated: number;
  changedFiles: FileChange[];
  cost?: number;
  /** Circuit breaker: consecutive "can't be edited" failures counter */
  cantEditFailCount: number;
  /** messageId that failures were counted against (reset on id change) */
  cantEditFailMessageId: number | null;
}
