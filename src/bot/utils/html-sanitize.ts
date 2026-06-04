/**
 * Sanitize HTML for Telegram HTML parse mode.
 *
 * Telegram's HTML parser is strict: every opening tag must have a matching closing tag,
 * tags cannot be interleaved (e.g. `<b><i>x</b></i>` is rejected), and only a limited
 * set of tags is supported.
 *
 * This function:
 * 1. Strips any tags not allowed by Telegram.
 * 2. Removes orphaned closing tags (no matching opener).
 * 3. Appends missing closing tags at the end in correct order.
 *
 * Allowed tags: b, i, u, s, code, pre, a (with href), blockquote, emoji.
 */

/**
 * Tags supported by Telegram Bot API HTML parse mode.
 * See: https://core.telegram.org/bots/api#html-style
 * Note: <emoji> is NOT a supported Telegram Bot API tag (it's internal to OpenCode).
 */
const ALLOWED_TAGS = new Set([
  "b",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "a",
  "blockquote",
  "br",
]);

/** Tags that don't need a closing tag. */
const VOID_TAGS = new Set<string>(["br", "hr", "img"]);

/** Matches any HTML tag. */
const TAG_REGEX = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

export function sanitizeHtmlForTelegram(html: string): string {
  // Phase 1: Parse all tags, filter allowed, rebuild string
  const parts: string[] = [];
  const openStack: string[] = []; // stack of open tags for nesting validation
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(html)) !== null) {
    // Push text before this tag, escaping literal <, >, &
    const textBefore = html.slice(lastIndex, match.index);
    parts.push(
      textBefore
        .replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
    );

    const slash = match[1];
    const tagName = match[2].toLowerCase();
    const attrs = match[3];

    if (!ALLOWED_TAGS.has(tagName)) {
      // Strip disallowed tag entirely, keep no trace
      lastIndex = match.index + match[0].length;
      continue;
    }

    if (VOID_TAGS.has(tagName)) {
      // Void tag — output as-is (lowercased), no stack tracking
      parts.push(`<${tagName}${attrs}>`);
      lastIndex = match.index + match[0].length;
      continue;
    }

    if (slash) {
      // Closing tag — validate against stack
      // Find matching open tag from the top
      let foundIndex = -1;
      for (let i = openStack.length - 1; i >= 0; i--) {
        if (openStack[i] === tagName) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex >= 0) {
        // Implicitly close any tags between foundIndex and top (interleaved fix)
        // e.g. stack=[b, i], closing </b> -> emit </i> first, then </b>
        const implicitlyClosed = openStack.slice(foundIndex + 1);
        for (const innerTag of implicitlyClosed.reverse()) {
          parts.push(`</${innerTag}>`);
        }
        // Pop everything from foundIndex onwards (including the matched tag)
        openStack.length = foundIndex;
        parts.push(`</${tagName}>`);
      }
      // else: orphaned closing tag — silently drop it

      lastIndex = match.index + match[0].length;
      continue;
    }

    // Opening tag
    openStack.push(tagName);

    // Reconstruct allowed opening tag
    if (tagName === "a" && attrs) {
      parts.push(`<a${attrs}>`);
    } else if (tagName === "blockquote" && attrs) {
      parts.push(`<blockquote${attrs}>`);
    } else {
      parts.push(`<${tagName}>`);
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text after last tag and escape unescaped <, >, &
  const remaining = html.slice(lastIndex);
  // Escape literal <, >, & that are not part of valid HTML tags
  parts.push(
    remaining
      .replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  );

  // Phase 2: Append missing closing tags in reverse stack order
  const unclosed = [...openStack].reverse();
  for (const tag of unclosed) {
    parts.push(`</${tag}>`);
  }

  return parts.join("");
}
