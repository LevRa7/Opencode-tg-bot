/**
 * Maximum characters per Telegram message part for plain text (no entities/markup).
 * Telegram Bot API enforces 4096 for sendMessage text parameter.
 */
export const TELEGRAM_PLAIN_MAX_LENGTH = 4096;

/**
 * Maximum characters per Telegram message part for rich content (with entities/markup).
 * Rich messages support a higher limit than plain text.
 */
export const TELEGRAM_RICH_MAX_LENGTH = 32000;
