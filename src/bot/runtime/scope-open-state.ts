const pathIndexByScope = new Map<string, Map<string, string>>();
let globalCounter = 0;

export function clearScopeOpenPathIndex(scopeKey: string): void {
  pathIndexByScope.delete(scopeKey);
}

export function encodeScopedPathReference(scopeKey: string, fullPath: string): string {
  const key = `#${globalCounter++}`;
  let index = pathIndexByScope.get(scopeKey);
  if (!index) {
    index = new Map();
    pathIndexByScope.set(scopeKey, index);
  }
  index.set(key, fullPath);
  return key;
}

export function decodeScopedPathReference(scopeKey: string, reference: string): string | null {
  return pathIndexByScope.get(scopeKey)?.get(reference) ?? null;
}

export function __resetScopeOpenStateForTests(): void {
  pathIndexByScope.clear();
  globalCounter = 0;
}
