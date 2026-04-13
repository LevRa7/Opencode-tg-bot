export interface PendingAssistantToolCall {
  tool: string;
  title?: string;
  input?: { [key: string]: unknown };
}

export interface PendingAssistantResponse {
  messageText: string;
  reasoningText?: string;
  toolCalls?: PendingAssistantToolCall[];
}

export interface PendingAssistantResponseStore {
  set(sessionId: string, response: PendingAssistantResponse): void;
  consume(sessionId: string): PendingAssistantResponse | null;
  clear(sessionId: string): void;
  clearAll(): void;
}

class InMemoryPendingAssistantResponseStore implements PendingAssistantResponseStore {
  private readonly responses = new Map<string, PendingAssistantResponse>();

  set(sessionId: string, response: PendingAssistantResponse): void {
    if (!sessionId) {
      return;
    }

    this.responses.set(sessionId, response);
  }

  consume(sessionId: string): PendingAssistantResponse | null {
    const response = this.responses.get(sessionId) ?? null;
    this.responses.delete(sessionId);
    return response;
  }

  clear(sessionId: string): void {
    this.responses.delete(sessionId);
  }

  clearAll(): void {
    this.responses.clear();
  }
}

export function createPendingAssistantResponseStore(): PendingAssistantResponseStore {
  return new InMemoryPendingAssistantResponseStore();
}
