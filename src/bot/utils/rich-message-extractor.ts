/**
 * Extracts plain text from Telegram `rich_message` blocks format.
 *
 * rich_message.blocks contain structured content:
 * - paragraph: { type: "paragraph", text: (string | { type: "bold"|"italic"|..., text: string })[] }
 * - pre: { type: "pre", text: string }
 * - heading: { type: "heading", text: string, size: number }
 * - table: { type: "table", cells: { text: string, is_header?: boolean, align?: string }[][] }
 * - unordered_list / ordered_list: { type: "unordered_list"|"ordered_list", items: string[] }
 * - blockquote: { type: "blockquote", text: ... }
 */

interface RichTextSpan {
  type?: string;
  text?: string;
}

interface RichBlock {
  type: string;
  text?: string | (string | RichTextSpan)[];
  size?: number;
  cells?: { text?: string | (string | RichTextSpan)[]; is_header?: boolean }[][];
  items?: string[];
  // details block (collapsible section)
  summary?: string;
  blocks?: RichBlock[];
}

function flattenRichText(
  text: string | (string | RichTextSpan)[] | undefined,
): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text
    .map((part) => (typeof part === "string" ? part : part.text || ""))
    .join("");
}

function blockToMarkdown(block: RichBlock): string {
  switch (block.type) {
    case "paragraph":
      return flattenRichText(block.text);

    case "pre":
      return "```\n" + (typeof block.text === "string" ? block.text : "") + "\n```";

    case "heading": {
      const level = Math.min((block.size || 2), 6);
      const prefix = "#".repeat(level);
      return (
        prefix +
        " " +
        (typeof block.text === "string" ? block.text : flattenRichText(block.text))
      );
    }

    case "unordered_list":
      return (block.items || []).map((item) => "- " + item).join("\n");

    case "ordered_list":
      return (block.items || []).map((item, i) => `${i + 1}. ${item}`).join("\n");

    case "blockquote":
      return (
        "> " +
        flattenRichText(block.text)
          .split("\n")
          .join("\n> ")
      );

    case "table": {
      const cells = block.cells || [];
      if (cells.length === 0) return "";
      // cell.text can be string, string[], or RichTextSpan[]
      const cellText = (cell: { text?: string | (string | RichTextSpan)[] }) => {
        const t = cell.text;
        if (typeof t === "string") return t.trim();
        if (Array.isArray(t)) return flattenRichText(t).trim();
        return "";
      };
      const rows = cells.map((row) =>
        row.map((cell) => cellText(cell)).join(" | "),
      );
      // Add separator after header row
      const hasHeader = cells[0]?.some((c) => c.is_header);
      if (hasHeader && rows.length > 1) {
        const sep =
          "|" +
          cells[0]
            .map(() => "---")
            .join("|") +
          "|";
        return (
          "| " + cells[0].map((c) => cellText(c)).join(" | ") + " |\n" + sep + "\n| " +
          cells
            .slice(1)
            .map((row) => row.map((c) => cellText(c)).join(" | "))
            .join(" |\n| ") +
          " |"
        );
      }
      return rows.map((r) => "| " + r + " |").join("\n");
    }

    case "details": {
      // Collapsible section — extract summary + nested blocks
      const summary = block.summary || "";
      const nestedText = (block.blocks || [])
        .map(blockToMarkdown)
        .filter(Boolean)
        .join("\n\n");
      if (summary && nestedText) {
        return `<details>\n<summary>${summary}</summary>\n\n${nestedText}\n\n</details>`;
      }
      if (nestedText) return nestedText;
      if (summary) return summary;
      return "";
    }

    default:
      // Unknown block type — try to extract text
      if (typeof block.text === "string") return block.text;
      if (Array.isArray(block.text)) return flattenRichText(block.text);
      if (block.items) return block.items.join("\n");
      return "";
  }
}

/**
 * Extract Markdown-ish plain text from Telegram rich_message blocks.
 * Returns empty string if no rich_message or blocks present.
 */
export function extractRichMessageText(
  richMessage: { blocks?: RichBlock[] } | undefined,
): string {
  if (!richMessage?.blocks || richMessage.blocks.length === 0) return "";
  return richMessage.blocks.map(blockToMarkdown).filter(Boolean).join("\n\n");
}
