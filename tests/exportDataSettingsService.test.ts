import { describe, expect, it } from 'vitest'

describe('export_data settings-backed service contract', () => {
  it('exposes getRootMenu/getScopeMenu/applyAction', async () => {
    const mod = await import('../src/bot/handlers/export-data-settings-service.js')
    const service = mod.createExportDataSettingsService({
      load: async () => ({}),
      save: async () => undefined,
      listChatsByScope: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
    })
    expect(typeof service.getRootMenu).toBe('function')
    expect(typeof service.getScopeMenu).toBe('function')
    expect(typeof service.applyAction).toBe('function')
  })

  it('persists default root config for a user', async () => {
    const mod = await import('../src/bot/handlers/export-data-settings-service.js')
    let state: any = {}
    const service = mod.createExportDataSettingsService({
      load: async () => state,
      save: async (next: any) => {
        state = next
      },
      listChatsByScope: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
    })
    const menu = await service.getRootMenu('owner-1')
    expect(menu.groups.personal).toBe(true)
    expect(menu.preferences.include_media).toBe(false)
  })

  it('applies scope_toggle into persisted state', async () => {
    const mod = await import('../src/bot/handlers/export-data-settings-service.js')
    let state: any = {}
    const service = mod.createExportDataSettingsService({
      load: async () => state,
      save: async (next: any) => {
        state = next
      },
      listChatsByScope: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
    })
    await service.applyAction({ type: 'scope_toggle', userId: 'owner-1', scopeName: 'bots', enabled: true })
    const menu = await service.getRootMenu('owner-1')
    expect(menu.groups.bots).toBe(true)
  })

  it('applies preferences_update into persisted state', async () => {
    const mod = await import('../src/bot/handlers/export-data-settings-service.js')
    let state: any = {}
    const service = mod.createExportDataSettingsService({
      load: async () => state,
      save: async (next: any) => {
        state = next
      },
      listChatsByScope: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
    })
    await service.applyAction({
      type: 'preferences_update',
      userId: 'owner-1',
      preferences: {
        include_media: true,
        media_kinds: ['voice', 'video_note'],
        max_file_size_bytes: 50 * 1024 * 1024,
        since_ts: '2026-01-01T00:00:00+00:00',
        until_ts: '2026-02-01T00:00:00+00:00',
      },
    })
    const menu = await service.getRootMenu('owner-1')
    expect(menu.preferences.include_media).toBe(true)
    expect(menu.preferences.media_kinds).toContain('voice')
    expect(menu.preferences.max_file_size_bytes).toBe(50 * 1024 * 1024)
  })
})
