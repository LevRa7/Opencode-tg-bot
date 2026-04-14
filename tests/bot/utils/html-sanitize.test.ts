import { describe, expect, it } from "vitest";
import { sanitizeHtmlForTelegram } from "../../../src/bot/utils/html-sanitize.js";

describe("bot/utils/html-sanitize", () => {
  describe("basic passthrough", () => {
    it("returns plain text unchanged", () => {
      expect(sanitizeHtmlForTelegram("hello world")).toBe("hello world");
    });

    it("returns valid HTML unchanged", () => {
      expect(sanitizeHtmlForTelegram("<b>bold</b> and <i>italic</i>")).toBe(
        "<b>bold</b> and <i>italic</i>",
      );
    });

    it("handles empty string", () => {
      expect(sanitizeHtmlForTelegram("")).toBe("");
    });
  });

  describe("closing unclosed tags", () => {
    it("closes unclosed <b>", () => {
      const result = sanitizeHtmlForTelegram("<b>bold text");
      expect(result).toBe("<b>bold text</b>");
    });

    it("closes multiple unclosed tags in correct order", () => {
      const result = sanitizeHtmlForTelegram("<b><i>nested");
      expect(result).toBe("<b><i>nested</i></b>");
    });

    it("closes unclosed <blockquote>", () => {
      const result = sanitizeHtmlForTelegram("<blockquote expandable>some text");
      expect(result).toBe("<blockquote expandable>some text</blockquote>");
    });

    it("closes unclosed <pre>", () => {
      const result = sanitizeHtmlForTelegram("<pre>code here");
      expect(result).toBe("<pre>code here</pre>");
    });

    it("closes deeply nested unclosed tags", () => {
      const result = sanitizeHtmlForTelegram("<b><i><s>deep");
      expect(result).toBe("<b><i><s>deep</s></i></b>");
    });
  });

  describe("removing orphaned closing tags", () => {
    it("removes orphaned </b>", () => {
      const result = sanitizeHtmlForTelegram("text</b>more");
      expect(result).toBe("textmore");
    });

    it("removes orphaned </i>", () => {
      const result = sanitizeHtmlForTelegram("text</i>");
      expect(result).toBe("text");
    });

    it("removes orphaned </blockquote>", () => {
      const result = sanitizeHtmlForTelegram("</blockquote>");
      expect(result).toBe("");
    });
  });

  describe("fixing interleaved tags", () => {
    it("fixes <b><i>x</b></i> — drops orphaned </b>, keeps valid nesting", () => {
      // Input: <b> opens, <i> opens, </b> tries to close b but i is on top -> orphaned
      // </i> closes i, then b is still open -> gets closed at end
      const result = sanitizeHtmlForTelegram("<b><i>x</b></i>");
      expect(result).toBe("<b><i>x</i></b>");
    });

    it("fixes <i><b>x</i></b> — drops orphaned </i>", () => {
      const result = sanitizeHtmlForTelegram("<i><b>x</i></b>");
      expect(result).toBe("<i><b>x</b></i>");
    });
  });

  describe("stripping disallowed tags", () => {
    it("strips <div> tags, keeps content", () => {
      const result = sanitizeHtmlForTelegram("<div>content</div>");
      expect(result).toBe("content");
    });

    it("strips <span> tags, keeps content", () => {
      const result = sanitizeHtmlForTelegram("<span>text</span>");
      expect(result).toBe("text");
    });

    it("strips <script> entirely", () => {
      const result = sanitizeHtmlForTelegram("<script>alert(1)</script>");
      expect(result).toBe("alert(1)");
    });

    it("strips unknown tags but preserves allowed inner tags", () => {
      const result = sanitizeHtmlForTelegram("<div><b>bold</b></div>");
      expect(result).toBe("<b>bold</b>");
    });
  });

  describe("allowed tags preserved", () => {
    it("preserves <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <blockquote>", () => {
      const input =
        "<b>b</b><i>i</i><u>u</u><s>s</s><code>c</code><pre>p</pre><a href='x'>a</a><blockquote>q</blockquote>";
      const result = sanitizeHtmlForTelegram(input);
      expect(result).toBe(input);
    });

    it("preserves <a href> with attributes", () => {
      const input = '<a href="https://example.com">link</a>';
      const result = sanitizeHtmlForTelegram(input);
      expect(result).toBe(input);
    });

    it("preserves <blockquote expandable>", () => {
      const input = "<blockquote expandable>text</blockquote>";
      const result = sanitizeHtmlForTelegram(input);
      expect(result).toBe(input);
    });
  });

  describe("void tags", () => {
    it("handles <br> without closing", () => {
      const result = sanitizeHtmlForTelegram("line1<br>line2");
      expect(result).toBe("line1<br>line2");
    });
  });

  describe("disallowed tags stripped", () => {
    it("strips <emoji> tags entirely (not supported by Telegram Bot API)", () => {
      const result = sanitizeHtmlForTelegram("text<emoji>123</emoji>more");
      expect(result).toBe("text123more");
    });

    it("strips unclosed <emoji> tag", () => {
      const result = sanitizeHtmlForTelegram("text<emoji>123");
      expect(result).toBe("text123");
    });
  });

  describe("real-world broken HTML scenarios", () => {
    it("fixes truncated HTML from streaming (missing closing tags)", () => {
      // Simulates progressive stream cut mid-content
      const input = "<b>Step 1:</b> Do this\n<i>Step 2:</i> Do that\n<b>Step 3:";
      const result = sanitizeHtmlForTelegram(input);
      expect(result).toBe(
        "<b>Step 1:</b> Do this\n<i>Step 2:</i> Do that\n<b>Step 3:</b>",
      );
    });

    it("fixes interleaved bold/italic from markdown regex", () => {
      // Simulates markdownToHtml producing interleaved tags
      const input = "<b><i>bold and italic</b></i>";
      const result = sanitizeHtmlForTelegram(input);
      expect(result).toBe("<b><i>bold and italic</i></b>");
    });

    it("fixes unclosed blockquote from chunk splitting", () => {
      const input = "<blockquote expandable><b>Reasoning</b>\n<i>Details";
      const result = sanitizeHtmlForTelegram(input);
      expect(result).toBe(
        "<blockquote expandable><b>Reasoning</b>\n<i>Details</i></blockquote>",
      );
    });

    it("handles mixed valid and broken tags", () => {
      const input = "<b>ok</b><i>broken</i>text</b><s>more";
      const result = sanitizeHtmlForTelegram(input);
      // </b> is orphaned (no open b), <s> is unclosed
      expect(result).toBe("<b>ok</b><i>broken</i>text<s>more</s>");
    });
  });

  describe("tag case normalization", () => {
    it("normalizes tag names to lowercase", () => {
      const result = sanitizeHtmlForTelegram("<B>text</B>");
      expect(result).toBe("<b>text</b>");
    });

    it("normalizes mixed-case tags", () => {
      const result = sanitizeHtmlForTelegram("<BlockQuote>text</BlockQuote>");
      expect(result).toBe("<blockquote>text</blockquote>");
    });
  });
});
