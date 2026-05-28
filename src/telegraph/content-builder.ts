export type TelegraphNode = string | TelegraphElement;

export interface TelegraphElement {
  tag: string;
  attrs?: Record<string, string>;
  children?: TelegraphNode[];
}

/**
 * Converts markdown-like text into Telegraph DOM node array.
 * Supports: code fences, headers, blockquotes, lists, horizontal rules,
 * and inline formatting (bold, italic, inline code).
 */
export function buildTelegraphContent(text: string): TelegraphElement[] {
  const lines = text.split(/\r?\n/);
  const nodes: TelegraphElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code fence block (`` or ``` or ~~~, with optional language)
    const fenceMatch = line.match(/^(`{2,}|~{3,})(\w*)\s*$/);
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      const fenceChar = fence.charAt(0);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const closingMatch = lines[i]!.match(/^(`{2,}|~{3,})\s*$/);
        if (closingMatch && closingMatch[1]!.charAt(0) === fenceChar && closingMatch[1]!.length >= fence.length) {
          i++;
          break;
        }
        codeLines.push(lines[i]!);
        i++;
      }
      const codeText = codeLines.join("\n");
      if (codeText.trim().length > 0) {
        nodes.push({ tag: "pre", children: [codeText] });
      }
      continue;
    }

    // Empty line — skip
    if (line.trim().length === 0) {
      i++;
      continue;
    }

    // Horizontal rule (---, ***, ___ with at least 3 chars)
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      nodes.push({ tag: "hr" });
      i++;
      continue;
    }

    // Header (# to ####)
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1]!.length;
      // Telegraph only supports h3, h4
      const tag = level <= 3 ? "h3" : "h4";
      nodes.push({ tag, children: parseInline(headerMatch[2]!.trim()) });
      i++;
      continue;
    }

    // Blockquote (> text)
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      const quoteText = quoteLines.join("\n").trim();
      if (quoteText.length > 0) {
        nodes.push({ tag: "blockquote", children: parseInline(quoteText) });
      }
      continue;
    }

    // Unordered list (- item, * item, + item)
    const ulMatch = line.match(/^(\s*)[*\-+]\s+(.*)$/);
    if (ulMatch) {
      const listItems: TelegraphElement[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i]!.match(/^(\s*)[*\-+]\s+(.*)$/);
        if (!itemMatch) break;
        listItems.push({ tag: "li", children: parseInline(itemMatch[2]!.trim()) });
        i++;
      }
      nodes.push({ tag: "ul", children: listItems });
      continue;
    }

    // Ordered list (1. item, 2. item)
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (olMatch) {
      const listItems: TelegraphElement[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i]!.match(/^(\s*)\d+[.)]\s+(.*)$/);
        if (!itemMatch) break;
        listItems.push({ tag: "li", children: parseInline(itemMatch[2]!.trim()) });
        i++;
      }
      nodes.push({ tag: "ol", children: listItems });
      continue;
    }

    // Regular paragraph — collect consecutive non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim().length === 0) break;
      if (/^(`{3,}|~{3,})/.test(l)) break;
      if (/^#{1,4}\s+/.test(l)) break;
      if (l.startsWith(">")) break;
      if (/^(\s*)[*\-+]\s+/.test(l)) break;
      if (/^(\s*)\d+[.)]\s+/.test(l)) break;
      if (/^(\s*[-*_]\s*){3,}$/.test(l)) break;
      paraLines.push(l);
      i++;
    }

    if (paraLines.length > 0) {
      const paraText = paraLines.join("\n").trim();
      if (paraText.length > 0) {
        nodes.push({ tag: "p", children: parseInline(paraText) });
      }
    }
  }

  return nodes.length > 0 ? nodes : [{ tag: "p", children: ["(empty)"] }];
}

/**
 * Parses inline markdown formatting: bold, italic, inline code, strikethrough.
 * Returns an array of Telegraph nodes (strings and elements).
 */
function parseInline(text: string): TelegraphNode[] {
  const nodes: TelegraphNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Inline code (backtick)
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
    if (codeMatch) {
      if (codeMatch[1]!.length > 0) {
        pushTextNodes(nodes, codeMatch[1]!);
      }
      nodes.push({ tag: "code", children: [codeMatch[2]!] });
      remaining = remaining.slice(codeMatch[0]!.length);
      continue;
    }

    // Bold (**text** or __text__)
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/);
    const boldMatch2 = remaining.match(/^(.*?)__(.+?)__/);
    const bold = pickShorterMatch(boldMatch, boldMatch2);
    if (bold) {
      if (bold[1]!.length > 0) {
        pushTextNodes(nodes, bold[1]!);
      }
      nodes.push({ tag: "b", children: parseInline(bold[2]!) });
      remaining = remaining.slice(bold[0]!.length);
      continue;
    }

    // Italic (*text* or _text_ — single, not preceded by another *)
    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*/);
    const italicMatch2 = remaining.match(/^(.*?)_([^_]+)_/);
    const italic = pickShorterMatch(italicMatch, italicMatch2);
    if (italic) {
      if (italic[1]!.length > 0) {
        pushTextNodes(nodes, italic[1]!);
      }
      nodes.push({ tag: "em", children: parseInline(italic[2]!) });
      remaining = remaining.slice(italic[0]!.length);
      continue;
    }

    // Strikethrough (~~text~~)
    const strikeMatch = remaining.match(/^(.*?)~~(.+?)~~/);
    if (strikeMatch) {
      if (strikeMatch[1]!.length > 0) {
        pushTextNodes(nodes, strikeMatch[1]!);
      }
      nodes.push({ tag: "s", children: [strikeMatch[2]!] });
      remaining = remaining.slice(strikeMatch[0]!.length);
      continue;
    }

    // No more inline patterns found — push rest as text
    pushTextNodes(nodes, remaining);
    break;
  }

  return nodes;
}

function pushTextNodes(nodes: TelegraphNode[], text: string): void {
  if (text.includes("\n")) {
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]!.length > 0) {
        nodes.push(parts[i]!);
      }
      if (i < parts.length - 1) {
        nodes.push({ tag: "br" });
      }
    }
  } else {
    nodes.push(text);
  }
}

function pickShorterMatch(
  a: RegExpMatchArray | null,
  b: RegExpMatchArray | null,
): RegExpMatchArray | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a[0]!.length <= b[0]!.length ? a : b;
}
