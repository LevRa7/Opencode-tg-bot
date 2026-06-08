import type { Context } from "grammy";

const MAX_QUOTE_TEXT_LENGTH = 200;

function formatTimestamp(unix: number): string {
  const date = new Date(unix * 1000);
  const iso = date.toISOString().replace("T", " ").slice(0, 16);
  return `${iso} UTC`;
}

function buildSenderName(from: { username?: string; first_name?: string; last_name?: string }): string {
  if (from.username) {
    return `@${from.username}`;
  }

  return [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || "Unknown";
}

function truncateQuote(text: string): string {
  if (text.length <= MAX_QUOTE_TEXT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_QUOTE_TEXT_LENGTH - 3)}...`;
}

export function formatReplyTag(ctx: Context): string | null {
  const msg = ctx.message;
  if (!msg) return null;

  const replyTo = msg.reply_to_message;
  if (!replyTo) return null;

  const quoteText = msg.quote?.text ?? replyTo.text ?? replyTo.caption;
  if (!quoteText) return null;

  const sender = replyTo.from ? buildSenderName(replyTo.from) : "Unknown";
  const timestamp = formatTimestamp(replyTo.date);
  const truncated = truncateQuote(quoteText.replace(/\s+/g, " ").trim());

  return `[Reply: ${sender} ${timestamp} - ${truncated}]`;
}
