import { describe, expect, it } from 'vitest'

describe('export_data backend provider contract', () => {
  it('provides root menu from config service', async () => {
    const mod = await import('../src/bot/handlers/export-data-provider.js')
    const provider = mod.createExportDataBackendProvider({
      getEffectiveConfig: async (_userId: string) => ({
        profile: {
          default_scope: 'personal',
          include_media: false,
          media_kinds_json: [],
          max_file_size_bytes: 20 * 1024 * 1024,
          since_ts: null,
          until_ts: null,
        },
        scopes: { personal: true, bots: false, group_chats: false, public_channels: false, interlocutor_channels: false },
        chat_overrides: {},
      }),
      listScopeChats: async () => [],
      applyAction: async () => undefined,
    })
    const menu = await provider.getRootMenu('owner-1')
    expect(menu.groups.personal).toBe(true)
    expect(menu.preferences.include_media).toBe(false)
  })

  it('provides scope submenu from service chat listing', async () => {
    const mod = await import('../src/bot/handlers/export-data-provider.js')
    const provider = mod.createExportDataBackendProvider({
      getEffectiveConfig: async () => ({ profile: null, scopes: {}, chat_overrides: {} }),
      listScopeChats: async (_userId: string, scopeName: string) => ({
        scope_name: scopeName,
        label: 'Личные',
        chats: [{ chat_id: 1, chat_name: 'Alice', enabled: true }],
      }),
      applyAction: async () => undefined,
    })
    const scope = await provider.getScopeMenu('owner-1', 'personal')
    expect(scope.scope_name).toBe('personal')
    expect(scope.chats[0].chat_name).toBe('Alice')
  })

  it('delegates action application to service layer', async () => {
    const mod = await import('../src/bot/handlers/export-data-provider.js')
    const calls: unknown[] = []
    const provider = mod.createExportDataBackendProvider({
      getEffectiveConfig: async () => ({ profile: null, scopes: {}, chat_overrides: {} }),
      listScopeChats: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
      applyAction: async (action: unknown) => {
        calls.push(action)
      },
    })
    const action = { type: 'scope_toggle', userId: 'owner-1', scopeName: 'bots', enabled: true }
    await provider.applyAction(action)
    expect(calls).toEqual([action])
  })
})
