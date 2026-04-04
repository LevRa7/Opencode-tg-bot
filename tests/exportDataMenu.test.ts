import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { resetRuntimeLocale, setRuntimeLocale, t } from '../src/i18n/index.js'

describe('export_data bot UI contract', () => {
  beforeEach(() => {
    resetRuntimeLocale()
    setRuntimeLocale('en')
  })

  afterEach(() => {
    resetRuntimeLocale()
  })

  it('registers export_data command in bot command definitions', async () => {
    const mod = await import('../src/bot/commands/definitions.js')
    const exportData = mod.getLocalizedBotCommands({ isAdmin: true }).find(
      (item: { command: string }) => item.command === 'export_data',
    )
    expect(exportData?.description).toBe(t('cmd.description.export_data'))
    expect(exportData?.description).not.toBe(t('cmd.description.help'))
  })

  it('exposes export data menu builder', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    expect(typeof mod.showExportDataMenu).toBe('function')
  })

  it('root menu model stays language-neutral and renders localized labels', async () => {
    const mod = await import('../src/bot/handlers/export-data.js')
    const menu = mod.buildExportDataRootMenuModel({
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
    })

    expect(menu.groupKeys).toEqual(['personal', 'bots', 'group_chats', 'public_channels', 'interlocutor_channels'])
    setRuntimeLocale('ru')
    expect(t('export_data.group.personal')).toBe('Личные')
    expect(t('export_data.group.bots')).toBe('Боты')
  })
})
