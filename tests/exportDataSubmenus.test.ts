import { describe, expect, it } from 'vitest'

describe('export_data submenu and preference flow', () => {
  it('loads personal scope submenu from backend', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const backend = {
      getScopeMenu: async (_userId: string, scopeName: string) => ({
        scope_name: scopeName,
        label: 'Личные',
        chats: [
          { chat_id: 1, chat_name: 'Alice', enabled: true },
          { chat_id: 2, chat_name: 'Bob', enabled: false },
        ],
      }),
    }
    const model = await mod.loadExportDataScopeModel(backend as never, 'owner-1', 'personal')
    expect(model.scope_name).toBe('personal')
    expect(model.chats.length).toBe(2)
  })

  it('whole group toggle updates all chats in submenu model', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const next = mod.applyScopeMenuToggleAll(
      {
        scope_name: 'personal',
        label: 'Личные',
        chats: [
          { chat_id: 1, chat_name: 'Alice', enabled: true },
          { chat_id: 2, chat_name: 'Bob', enabled: false },
        ],
      },
      true,
    )
    expect(next.chats.every((chat: { enabled: boolean }) => chat.enabled === true)).toBe(true)
  })

  it('chat toggle survives menu reload from backend', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const serviceCalls: unknown[] = []
    const service = {
      setChatEnabled: (...args: unknown[]) => serviceCalls.push(args),
    }
    await mod.applyExportDataAction(service as never, {
      type: 'chat_toggle',
      userId: 'owner-1',
      chatId: 2,
      scopeName: 'personal',
      enabled: true,
    })
    expect(serviceCalls).toEqual([['owner-1', { chatId: 2, scopeName: 'personal', enabled: true }]])
  })

  it('loads media preferences submenu from backend', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const backend = {
      getRootMenu: async () => ({
        groups: {
          personal: true,
          bots: false,
          group_chats: false,
          public_channels: false,
          interlocutor_channels: false,
        },
        preferences: {
          include_media: true,
          media_kinds: ['voice', 'video_note'],
          max_file_size_bytes: 20 * 1024 * 1024,
          since_ts: '2026-01-01T00:00:00+00:00',
          until_ts: '2026-02-01T00:00:00+00:00',
        },
      }),
    }
    const model = await mod.loadExportDataRootModel(backend as never, 'owner-1')
    expect(model.preferences.include_media).toBe(true)
    expect(model.preferences.media_kinds).toContain('voice')
  })

  it('updates since/until through backend payload', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const action = mod.buildPreferencesUpdateAction('owner-1', {
      include_media: true,
      media_kinds: ['voice'],
      max_file_size_bytes: 20 * 1024 * 1024,
      since_ts: '2026-01-01T00:00:00+00:00',
      until_ts: '2026-02-01T00:00:00+00:00',
    })
    expect(action.preferences.since_ts).toBe('2026-01-01T00:00:00+00:00')
    expect(action.preferences.until_ts).toBe('2026-02-01T00:00:00+00:00')
  })

  it('updates max file size through backend payload', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const action = mod.buildPreferencesUpdateAction('owner-1', {
      include_media: true,
      media_kinds: ['voice'],
      max_file_size_bytes: 50 * 1024 * 1024,
      since_ts: null,
      until_ts: null,
    })
    expect(action.preferences.max_file_size_bytes).toBe(50 * 1024 * 1024)
  })

  it('builds back action for scope submenu return', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    expect(mod.buildBackCallback('root')).toBe('export_data:back:root')
  })
})
