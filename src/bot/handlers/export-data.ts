import { Context, InlineKeyboard } from "grammy";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

export interface ExportDataRootMenuModel {
  groups: Record<string, boolean>;
  groupKeys: string[];
  preferences: {
    include_media: boolean;
    media_kinds: string[];
    max_file_size_bytes: number;
    since_ts: string | null;
    until_ts: string | null;
  };
}

export interface ExportDataScopeMenuModel {
  scope_name: string;
  label?: string;
  labelKey?: string;
  chats: Array<{ chat_id: number; chat_name: string; enabled: boolean }>;
}

export function buildExportDataRootMenuModel(config: {
  groups: Record<string, boolean>;
  preferences: {
    include_media: boolean;
    media_kinds: string[];
    max_file_size_bytes: number;
    since_ts: string | null;
    until_ts: string | null;
  };
}): ExportDataRootMenuModel {
  return {
    groups: config.groups,
    groupKeys: Object.keys(config.groups),
    preferences: config.preferences,
  };
}

export function applyScopeToggle(
  model: ExportDataRootMenuModel,
  scopeName: string,
): ExportDataRootMenuModel {
  return {
    ...model,
    groups: {
      ...model.groups,
      [scopeName]: !Boolean(model.groups[scopeName]),
    },
  };
}

export function applyChatToggle(
  model: ExportDataScopeMenuModel,
  chatId: number,
): ExportDataScopeMenuModel {
  return {
    ...model,
    chats: model.chats.map((chat) =>
      chat.chat_id === chatId ? { ...chat, enabled: !chat.enabled } : chat,
    ),
  };
}

export function applyPreferenceToggle(
  model: ExportDataRootMenuModel,
  key: 'include_media',
): ExportDataRootMenuModel {
  return {
    ...model,
    preferences: {
      ...model.preferences,
      [key]: !model.preferences[key],
    },
  };
}

export function applyMediaKindToggle(
  model: ExportDataRootMenuModel,
  mediaKind: string,
): ExportDataRootMenuModel {
  const set = new Set(model.preferences.media_kinds);
  if (set.has(mediaKind)) {
    set.delete(mediaKind);
  } else {
    set.add(mediaKind);
  }
  return {
    ...model,
    preferences: {
      ...model.preferences,
      media_kinds: [...set],
    },
  };
}

export function buildScopeToggleAction(userId: string, scopeName: string, enabled: boolean) {
  return {
    type: 'scope_toggle',
    userId,
    scopeName,
    enabled,
  };
}

export function buildChatToggleAction(
  userId: string,
  chatId: number,
  scopeName: string,
  enabled: boolean,
) {
  return {
    type: 'chat_toggle',
    userId,
    chatId,
    scopeName,
    enabled,
  };
}

export function buildPreferencesUpdateAction(
  userId: string,
  preferences: ExportDataRootMenuModel['preferences'],
) {
  return {
    type: 'preferences_update',
    userId,
    preferences,
  };
}

export function parseExportDataCallback(data: string):
  | { type: 'scope'; scopeName: string }
  | { type: 'back'; target: string }
  | { type: 'chat_toggle'; scopeName: string; chatId: number; enabled: boolean }
  | null {
  if (data.startsWith('export_data:scope:')) {
    return { type: 'scope', scopeName: data.slice('export_data:scope:'.length) };
  }
  if (data.startsWith('export_data:back:')) {
    return { type: 'back', target: data.slice('export_data:back:'.length) };
  }
  if (data.startsWith('export_data:chat_toggle:')) {
    const [, , scopeName, chatId, enabled] = data.split(':');
    return {
      type: 'chat_toggle',
      scopeName,
      chatId: Number(chatId),
      enabled: enabled === 'true',
    };
  }
  return null;
}

export function buildBackCallback(target: string): string {
  return `export_data:back:${target}`;
}

export function buildExportDataScopeKeyboardModel(model: ExportDataScopeMenuModel): {
  rows: Array<Array<{ text: string; callbackData: string }>>;
} {
  return {
    rows: model.chats.map((chat) => [
      {
        text: `${chat.enabled ? '✅' : '⬜'} ${chat.chat_name}`,
        callbackData: `export_data:chat_toggle:${model.scope_name}:${chat.chat_id}:${String(!chat.enabled)}`,
      },
    ]),
  };
}

export function routeExportDataCallback(data: string, userId: string) {
  const parsed = parseExportDataCallback(data);
  if (!parsed) return null;
  if (parsed.type === 'chat_toggle') {
    return buildChatToggleAction(userId, parsed.chatId, parsed.scopeName, parsed.enabled);
  }
  return parsed;
}

export async function applyExportDataAction(service: any, action: any): Promise<void> {
  if (action.type === 'scope_toggle') {
    await service.setScopeEnabled(action.userId, action.scopeName, action.enabled);
    return;
  }
  if (action.type === 'chat_toggle') {
    await service.setChatEnabled(action.userId, {
      chatId: action.chatId,
      scopeName: action.scopeName,
      enabled: action.enabled,
    });
    return;
  }
  if (action.type === 'preferences_update') {
    await service.updateProfile(action.userId, action.preferences);
  }
}

export async function loadExportDataRootModel(backend: any, userId: string): Promise<ExportDataRootMenuModel> {
  const config = await backend.getRootMenu(userId);
  return buildExportDataRootMenuModel(config);
}

export async function loadExportDataScopeModel(
  backend: any,
  userId: string,
  scopeName: string,
): Promise<ExportDataScopeMenuModel> {
  return backend.getScopeMenu(userId, scopeName);
}

export function applyScopeMenuToggleAll(
  model: ExportDataScopeMenuModel,
  enabled: boolean,
): ExportDataScopeMenuModel {
  return {
    ...model,
    chats: model.chats.map((chat) => ({ ...chat, enabled })),
  };
}

export async function showExportDataMenu(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text(t("export_data.group.personal"), 'export_data:scope:personal')
    .text(t("export_data.group.bots"), 'export_data:scope:bots')
    .row()
    .text(t("export_data.group.group_chats"), 'export_data:scope:group_chats')
    .text(t("export_data.group.public_channels"), 'export_data:scope:public_channels')
    .row()
    .text(t("export_data.group.interlocutor_channels"), 'export_data:scope:interlocutor_channels');

  await replyWithInlineMenu(ctx, {
    menuKind: 'context',
    text: t("export_data.title"),
    keyboard,
  });
}
