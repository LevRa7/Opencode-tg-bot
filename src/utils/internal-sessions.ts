const internalSessionIds = new Set<string>();

export function markAsInternalSession(sessionId: string): void {
  internalSessionIds.add(sessionId);
}

export function isInternalSession(sessionId: string): boolean {
  return internalSessionIds.has(sessionId);
}

export function clearInternalSession(sessionId: string): void {
  internalSessionIds.delete(sessionId);
}
