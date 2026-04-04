import { describe, expect, it } from 'vitest'

describe('export_data callback flow', () => {
  it('parses scope-open callback', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const parsed = mod.parseExportDataCallback('export_data:scope:personal')
    expect(parsed).toEqual({ type: 'scope', scopeName: 'personal' })
  })

  it('parses back callback', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const parsed = mod.parseExportDataCallback('export_data:back:root')
    expect(parsed).toEqual({ type: 'back', target: 'root' })
  })

  it('builds scope menu keyboard model with chat toggles', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const model = mod.buildExportDataScopeKeyboardModel({
      scope_name: 'personal',
      label: 'Личные',
      chats: [
        { chat_id: 1, chat_name: 'Alice', enabled: true },
        { chat_id: 2, chat_name: 'Bob', enabled: false },
      ],
    })
    expect(model.rows.length).toBeGreaterThan(0)
    expect(
      model.rows
        .flat()
        .some((btn: { callbackData: string }) => btn.callbackData.includes('chat_toggle:personal:1:')),
    ).toBe(true)
  })

  it('builds back action callback for root menu return', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    expect(mod.buildBackCallback('root')).toBe('export_data:back:root')
  })

  it('routes chat toggle callback into backend action payload', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const action = mod.routeExportDataCallback('export_data:chat_toggle:personal:731038050:false', 'owner-1')
    expect(action).toEqual({
      type: 'chat_toggle',
      userId: 'owner-1',
      chatId: 731038050,
      scopeName: 'personal',
      enabled: false,
    })
  })
})
