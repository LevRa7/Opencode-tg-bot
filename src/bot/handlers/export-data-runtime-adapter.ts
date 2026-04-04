export interface ExportDataRuntimeBackend {
  getRootMenu(userId: string): Promise<any>
  getScopeMenu(userId: string, scopeName: string): Promise<any>
  applyAction(action: unknown): Promise<void>
}

export function createExportDataRuntimeAdapter(backend: ExportDataRuntimeBackend) {
  return {
    async getRootMenu(userId: string) {
      return backend.getRootMenu(userId)
    },
    async getScopeMenu(userId: string, scopeName: string) {
      return backend.getScopeMenu(userId, scopeName)
    },
    async applyAction(action: unknown) {
      return backend.applyAction(action)
    },
  }
}
