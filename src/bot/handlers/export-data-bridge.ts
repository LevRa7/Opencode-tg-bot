export async function loadRootMenuFromBackend(backend: any, userId: string) {
  return backend.getRootMenu(userId)
}

export async function loadScopeMenuFromBackend(backend: any, userId: string, scopeName: string) {
  return backend.getScopeMenu(userId, scopeName)
}

export async function applyActionThroughBridge(backend: any, action: unknown) {
  return backend.applyAction(action)
}
