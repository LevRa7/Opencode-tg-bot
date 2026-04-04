import { describe, expect, it } from 'vitest'

describe('export_data runtime adapter contract', () => {
  it('creates adapter with root menu, scope menu and action methods', async () => {
    const mod = await import('../src/bot/handlers/export-data-runtime-adapter.js')
    const adapter = mod.createExportDataRuntimeAdapter({
      getRootMenu: async () => ({ groups: {}, preferences: { include_media: false, media_kinds: [], max_file_size_bytes: 20, since_ts: null, until_ts: null } }),
      getScopeMenu: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
      applyAction: async () => undefined,
    })
    expect(typeof adapter.getRootMenu).toBe('function')
    expect(typeof adapter.getScopeMenu).toBe('function')
    expect(typeof adapter.applyAction).toBe('function')
  })

  it('delegates root menu loading to backend service', async () => {
    const mod = await import('../src/bot/handlers/export-data-runtime-adapter.js')
    const adapter = mod.createExportDataRuntimeAdapter({
      getRootMenu: async (userId: string) => ({ userId, groups: {}, preferences: { include_media: false, media_kinds: [], max_file_size_bytes: 20, since_ts: null, until_ts: null } }),
      getScopeMenu: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
      applyAction: async () => undefined,
    })
    const result = await adapter.getRootMenu('owner-1')
    expect(result.userId).toBe('owner-1')
  })

  it('delegates scope menu loading to backend service', async () => {
    const mod = await import('../src/bot/handlers/export-data-runtime-adapter.js')
    const adapter = mod.createExportDataRuntimeAdapter({
      getRootMenu: async () => ({ groups: {}, preferences: { include_media: false, media_kinds: [], max_file_size_bytes: 20, since_ts: null, until_ts: null } }),
      getScopeMenu: async (_userId: string, scopeName: string) => ({ scope_name: scopeName, label: 'Личные', chats: [] }),
      applyAction: async () => undefined,
    })
    const result = await adapter.getScopeMenu('owner-1', 'personal')
    expect(result.scope_name).toBe('personal')
  })

  it('delegates action application to backend service', async () => {
    const mod = await import('../src/bot/handlers/export-data-runtime-adapter.js')
    let called = false
    const adapter = mod.createExportDataRuntimeAdapter({
      getRootMenu: async () => ({ groups: {}, preferences: { include_media: false, media_kinds: [], max_file_size_bytes: 20, since_ts: null, until_ts: null } }),
      getScopeMenu: async () => ({ scope_name: 'personal', label: 'Личные', chats: [] }),
      applyAction: async () => { called = true },
    })
    await adapter.applyAction({ type: 'scope_toggle', userId: 'owner-1', scopeName: 'bots', enabled: true })
    expect(called).toBe(true)
  })
})
