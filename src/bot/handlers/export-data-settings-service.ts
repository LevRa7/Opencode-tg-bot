export interface ExportDataSettingsStore {
  load(): Promise<any>
  save(next: any): Promise<void>
  listChatsByScope(userId: string, scopeName: string): Promise<any>
}

const DEFAULT_GROUPS = {
  personal: true,
  bots: false,
  group_chats: false,
  public_channels: false,
  interlocutor_channels: false,
}

const DEFAULT_PREFERENCES = {
  include_media: false,
  media_kinds: [] as string[],
  max_file_size_bytes: 20 * 1024 * 1024,
  since_ts: null as string | null,
  until_ts: null as string | null,
}

export function createExportDataSettingsService(store: ExportDataSettingsStore) {
  return {
    async getRootMenu(userId: string) {
      const state = (await store.load()) ?? {}
      const byUser = state.exportDataByUser ?? {}
      const current = byUser[userId] ?? {
        groups: { ...DEFAULT_GROUPS },
        preferences: { ...DEFAULT_PREFERENCES },
      }
      return current
    },

    async getScopeMenu(userId: string, scopeName: string) {
      return store.listChatsByScope(userId, scopeName)
    },

    async applyAction(action: any) {
      const state = (await store.load()) ?? {}
      state.exportDataByUser ??= {}
      state.exportDataByUser[action.userId] ??= {
        groups: { ...DEFAULT_GROUPS },
        preferences: { ...DEFAULT_PREFERENCES },
        chats: {},
      }
      const current = state.exportDataByUser[action.userId]

      if (action.type === 'scope_toggle') {
        current.groups[action.scopeName] = action.enabled
      } else if (action.type === 'chat_toggle') {
        current.chats[String(action.chatId)] = {
          scopeName: action.scopeName,
          enabled: action.enabled,
        }
      } else if (action.type === 'preferences_update') {
        current.preferences = {
          ...current.preferences,
          ...action.preferences,
        }
      }

      await store.save(state)
    },
  }
}
