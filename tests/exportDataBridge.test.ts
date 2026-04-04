import { describe, expect, it } from 'vitest'

describe('export_data bot-backend bridge', () => {
  it('maps root menu request to backend root menu call', async () => {
    const mod = await import('../src/bot/handlers/export-data-bridge.js')
    const calls: unknown[] = []
    const backend = {
      getRootMenu: async (userId: string) => {
        calls.push(userId)
        return { groups: {}, preferences: { include_media: false, media_kinds: [], max_file_size_bytes: 20, since_ts: null, until_ts: null } }
      },
    }
    await mod.loadRootMenuFromBackend(backend as never, 'owner-1')
    expect(calls).toEqual(['owner-1'])
  })

  it('maps scope submenu request to backend scope menu call', async () => {
    const mod = await import('../src/bot/handlers/export-data-bridge.js')
    const calls: unknown[] = []
    const backend = {
      getScopeMenu: async (userId: string, scopeName: string) => {
        calls.push([userId, scopeName])
        return { scope_name: scopeName, label: 'Личные', chats: [] }
      },
    }
    await mod.loadScopeMenuFromBackend(backend as never, 'owner-1', 'personal')
    expect(calls).toEqual([['owner-1', 'personal']])
  })

  it('applies routed action through backend bridge', async () => {
    const mod = await import('../src/bot/handlers/export-data-bridge.js')
    const calls: unknown[] = []
    const backend = {
      applyAction: async (action: unknown) => calls.push(action),
    }
    await mod.applyActionThroughBridge(backend as never, {
      type: 'scope_toggle',
      userId: 'owner-1',
      scopeName: 'bots',
      enabled: true,
    })
    expect(calls).toEqual([
      {
        type: 'scope_toggle',
        userId: 'owner-1',
        scopeName: 'bots',
        enabled: true,
      },
    ])
  })
})
