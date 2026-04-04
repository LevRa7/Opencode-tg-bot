export interface ExportDataServiceLike {
  getEffectiveConfig(userId: string): Promise<any>
  listScopeChats(userId: string, scopeName: string): Promise<any>
  applyAction(action: unknown): Promise<void>
}

export function createExportDataBackendProvider(service: ExportDataServiceLike) {
  return {
    async getRootMenu(userId: string) {
      const config = await service.getEffectiveConfig(userId)
      return {
        groups: config.scopes,
        preferences: {
          include_media: Boolean(config.profile?.include_media ?? false),
          media_kinds: config.profile?.media_kinds_json ?? [],
          max_file_size_bytes: config.profile?.max_file_size_bytes ?? 20 * 1024 * 1024,
          since_ts: config.profile?.since_ts ?? null,
          until_ts: config.profile?.until_ts ?? null,
        },
      }
    },
    async getScopeMenu(userId: string, scopeName: string) {
      return service.listScopeChats(userId, scopeName)
    },
    async applyAction(action: unknown) {
      return service.applyAction(action)
    },
  }
}
