import { describe, expect, it } from 'vitest'

describe('export_data toggle flow', () => {
  it('toggles a whole scope group state in menu model', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const next = mod.applyScopeToggle(
      {
        groups: {
          personal: true,
          bots: false,
          group_chats: false,
          public_channels: false,
          interlocutor_channels: false,
        },
        preferences: {
          include_media: false,
          media_kinds: [],
          max_file_size_bytes: 20 * 1024 * 1024,
          since_ts: null,
          until_ts: null,
        },
      },
      'bots',
    )
    expect(next.groups.bots).toBe(true)
  })

  it('toggles a single chat state inside a scope menu model', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const next = mod.applyChatToggle(
      {
        scope_name: 'personal',
        label: 'Личные',
        chats: [
          { chat_id: 1, chat_name: 'Alice', enabled: true },
          { chat_id: 2, chat_name: 'Bob', enabled: false },
        ],
      },
      2,
    )
    expect(next.chats.find((chat: { chat_id: number }) => chat.chat_id === 2)?.enabled).toBe(true)
  })

  it('applies media preference toggle correctly', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const next = mod.applyPreferenceToggle(
      {
        groups: {
          personal: true,
          bots: false,
          group_chats: false,
          public_channels: false,
          interlocutor_channels: false,
        },
        preferences: {
          include_media: false,
          media_kinds: [],
          max_file_size_bytes: 20 * 1024 * 1024,
          since_ts: null,
          until_ts: null,
        },
      },
      'include_media',
    )
    expect(next.preferences.include_media).toBe(true)
  })

  it('applies media kind selection correctly', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const next = mod.applyMediaKindToggle(
      {
        groups: {
          personal: true,
          bots: false,
          group_chats: false,
          public_channels: false,
          interlocutor_channels: false,
        },
        preferences: {
          include_media: true,
          media_kinds: ['voice'],
          max_file_size_bytes: 20 * 1024 * 1024,
          since_ts: null,
          until_ts: null,
        },
      },
      'video_note',
    )
    expect(next.preferences.media_kinds).toContain('voice')
    expect(next.preferences.media_kinds).toContain('video_note')
  })

  it('propagates scope toggle into backend payload shape', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const action = mod.buildScopeToggleAction('owner-1', 'public_channels', true)
    expect(action).toEqual({
      type: 'scope_toggle',
      userId: 'owner-1',
      scopeName: 'public_channels',
      enabled: true,
    })
  })

  it('propagates chat toggle into backend payload shape', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const action = mod.buildChatToggleAction('owner-1', 731038050, 'personal', false)
    expect(action).toEqual({
      type: 'chat_toggle',
      userId: 'owner-1',
      chatId: 731038050,
      scopeName: 'personal',
      enabled: false,
    })
  })

  it('propagates preferences update into backend payload shape', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const action = mod.buildPreferencesUpdateAction('owner-1', {
      include_media: true,
      media_kinds: ['voice', 'video_note'],
      max_file_size_bytes: 30 * 1024 * 1024,
      since_ts: '2026-01-01T00:00:00+00:00',
      until_ts: '2026-02-01T00:00:00+00:00',
    })
    expect(action.type).toBe('preferences_update')
    expect(action.preferences.media_kinds).toContain('voice')
    expect(action.preferences.max_file_size_bytes).toBe(30 * 1024 * 1024)
  })
})
