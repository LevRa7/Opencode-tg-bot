interface PromptRetryContext {
  directory: string;
  lastText: string;
  agent?: string;
}

const retryContextBySession = new Map<string, PromptRetryContext>();

export function setPromptRetryContext(
  sessionId: string,
  directory: string,
  lastText: string,
  agent?: string,
): void {
  retryContextBySession.set(sessionId, { directory, lastText, agent });
}

export function getPromptRetryContext(sessionId: string): PromptRetryContext | undefined {
  return retryContextBySession.get(sessionId);
}

export function deletePromptRetryContext(sessionId: string): void {
  retryContextBySession.delete(sessionId);
}
