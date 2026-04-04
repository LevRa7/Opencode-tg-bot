import { describe, expect, it } from 'vitest'

describe('export_data persistence wiring', () => {
  it('applies scope toggle action through backend service', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')

    const calls: unknown[] = []
    const service = {
      setScopeEnabled: (...args: unknown[]) => calls.push(args),
    }

    await mod.applyExportDataAction(service as never, {
      type: 'scope_toggle',
      userId: 'owner-1',
      scopeName: 'public_channels',
      enabled: true,
    })

    expect(calls).toEqual([['owner-1', 'public_channels', true]])
  })

  it('applies chat toggle action through backend service', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')

    const calls: unknown[] = []
    const service = {
      setChatEnabled: (...args: unknown[]) => calls.push(args),
    }

    await mod.applyExportDataAction(service as never, {
      type: 'chat_toggle',
      userId: 'owner-1',
      chatId: 731038050,
      scopeName: 'personal',
      enabled: false,
    })

    expect(calls).toEqual([['owner-1', { chatId: 731038050, scopeName: 'personal', enabled: false }]])
  })

  it('applies preferences update through backend service', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')

    const calls: unknown[] = []
    const service = {
      updateProfile: (...args: unknown[]) => calls.push(args),
    }

    await mod.applyExportDataAction(service as never, {
      type: 'preferences_update',
      userId: 'owner-1',
      preferences: {
        include_media: true,
        media_kinds: ['voice', 'video_note'],
        max_file_size_bytes: 30 * 1024 * 1024,
        since_ts: '2026-01-01T00:00:00+00:00',
        until_ts: '2026-02-01T00:00:00+00:00',
      },
    })

    expect(calls).toEqual([
      [
        'owner-1',
        {
          include_media: true,
          media_kinds: ['voice', 'video_note'],
          max_file_size_bytes: 30 * 1024 * 1024,
          since_ts: '2026-01-01T00:00:00+00:00',
          until_ts: '2026-02-01T00:00:00+00:00',
        },
      ],
    ])
  })

  it('rebuilds root menu model from persisted config after update', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')

    const backend = {
      getRootMenu: () => ({
        groups: {
          personal: true,
          bots: true,
          group_chats: false,
          public_channels: true,
          interlocutor_channels: false,
        },
        preferences: {
          include_media: true,
          media_kinds: ['voice'],
          max_file_size_bytes: 20 * 1024 * 1024,
          since_ts: null,
          until_ts: null,
        },
      }),
    }

    const model = await mod.loadExportDataRootModel(backend as never, 'owner-1')
    expect(model.groups.bots).toBe(true)
    expect(model.preferences.include_media).toBe(true)
  })
})
