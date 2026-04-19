import type { MessageEntity } from "grammy/types";

const ENTITY_TYPE_PRIORITY: Record<MessageEntity["type"], number> = {
  bold: 1,
  italic: 2,
  underline: 3,
  strikethrough: 4,
  spoiler: 5,
  code: 6,
  pre: 7,
  text_link: 8,
  mention: 100,
  hashtag: 101,
  cashtag: 102,
  bot_command: 103,
  url: 104,
  email: 105,
  phone_number: 106,
  blockquote: 107,
  expandable_blockquote: 108,
  text_mention: 109,
  custom_emoji: 110,
};

export function compareTelegramEntities(left: MessageEntity, right: MessageEntity): number {
  if (left.offset !== right.offset) {
    return left.offset - right.offset;
  }

  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return ENTITY_TYPE_PRIORITY[left.type] - ENTITY_TYPE_PRIORITY[right.type];
}

export function sortTelegramEntities(entities: MessageEntity[]): MessageEntity[] {
  return [...entities].sort(compareTelegramEntities);
}
